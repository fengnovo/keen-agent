import { randomUUID } from 'node:crypto';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  END, START, StateGraph, StateSchema, MessagesValue, ReducedValue,
  Overwrite, Send, MemorySaver, getWriter, getConfig,
} from '@langchain/langgraph';
import { filesValue, type FileData } from 'deepagents';
import { z } from 'zod';
import {
  planDecisionSchema, taskSpecSchema, taskResultSchema, validateDag, selectReadyTasks,
  type TaskSpec, type PlanDecision, type TaskResults, type TaskResult,
} from './task-plan.ts';
import { validateTaskPolicy, type CapabilityPolicy } from './policy.ts';

export type Files = Record<string, FileData>;
export type FileDelta = Record<string, FileData | null>;
/** Transport/provider failures cannot be corrected by asking for a different DAG. */
export class PlanningModelError extends Error {
  constructor(cause: unknown) {
    super(`规划模型不可用：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'PlanningModelError';
  }
}
export interface OrchestrationEvent {
  runId: string;
  event: 'run_started' | 'plan_committed' | 'plan_rejected' | 'worker_started' |
    'worker_completed' | 'worker_failed' | 'assessment' | 'finalized';
  version: number;
  taskId?: string;
  task?: TaskSpec;
  tasks?: TaskSpec[];
  result?: TaskResult;
  mode?: PlanDecision['mode'];
  message?: string;
  status?: 'completed' | 'blocked';
  concurrency?: number;
}

const WorkflowState = new StateSchema({
  messages: MessagesValue,
  files: filesValue,
  runId: z.string().default(''),
  version: z.number().default(0),
  tasks: z.array(taskSpecSchema).default([]),
  results: new ReducedValue(z.record(z.string(), taskResultSchema).default({}), {
    reducer: (current, next) => ({ ...current, ...next }),
  }),
  mode: z.enum(['direct', 'dag', 'finish', 'blocked']).default('direct'),
  rationale: z.string().default(''),
  planningError: z.boolean().default(false),
  stage: z.enum(['initial', 'assessment']).default('initial'),
});
type State = typeof WorkflowState.State;

export interface PlanningContext {
  messages: BaseMessage[];
  tasks: TaskSpec[];
  results: TaskResults;
  stage: 'initial' | 'assessment';
  version: number;
}
export interface ExecutionContext {
  messages: BaseMessage[];
  files: Files;
  dependencyResults: TaskResults;
}
export interface WorkflowHooks {
  plan(context: PlanningContext, config: RunnableConfig): Promise<PlanDecision>;
  work(task: TaskSpec, context: ExecutionContext, config: RunnableConfig): Promise<{ result: TaskResult; files?: FileDelta }>;
  direct(context: ExecutionContext, config: RunnableConfig): Promise<{ messages: BaseMessage[]; files?: FileDelta }>;
  finalize(context: PlanningContext & { status: 'completed' | 'blocked'; reason: string }, config: RunnableConfig): Promise<BaseMessage>;
}

export interface WorkflowOptions {
  hooks: WorkflowHooks;
  policy: CapabilityPolicy;
  maxConcurrency?: number;
  maxReplans?: number;
  onEvent?: (event: OrchestrationEvent) => void;
}

export function fileDelta(before: Files, after: Files): FileDelta {
  const delta: FileDelta = {};
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[path]) !== JSON.stringify(after[path])) delta[path] = after[path] ?? null;
  }
  return delta;
}

export function createAutonomousWorkflow(options: WorkflowOptions) {
  const { hooks, policy } = options;
  const boundedInteger = (value: number | undefined, fallback: number, min: number, max: number) =>
    Number.isInteger(value) ? Math.max(min, Math.min(value!, max)) : fallback;
  const concurrency = boundedInteger(options.maxConcurrency, 2, 1, 16);
  const maxReplans = boundedInteger(options.maxReplans, 2, 0, 5);
  const emit = (event: OrchestrationEvent) => {
    options.onEvent?.(event);
    getWriter()?.({ autonomy: event });
  };
  const executionContext = (state: State): ExecutionContext => ({
    messages: state.messages, files: state.files ?? {}, dependencyResults: state.results,
  });

  const graph = new StateGraph(WorkflowState)
    .addNode('initialize', () => {
      const runId = randomUUID();
      emit({ runId, event: 'run_started', version: 0, concurrency });
      return { runId, version: 0, tasks: [], results: new Overwrite({}),
        mode: 'direct' as const, rationale: '', planningError: false, stage: 'initial' as const };
    })
    .addNode('plan', async (state) => {
      const config = getConfig();
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        config.signal?.throwIfAborted();
        try {
          const proposal = planDecisionSchema.parse(await hooks.plan({
            ...state,
            messages: lastError ? [...state.messages, new AIMessage(`上次计划被运行时拒绝：${lastError}。请修正。`)] : state.messages,
          }, { ...config, tags: [...(config.tags ?? []), 'nostream'] }));
          const succeeded = state.tasks.filter(t => state.results[t.id]?.status === 'completed');
          const issues: string[] = [];
          if (proposal.mode !== 'dag' && proposal.tasks.length) issues.push('非 DAG 模式的 tasks 必须为空');
          if (state.stage === 'initial' && proposal.mode === 'finish') issues.push('首次规划不能直接标记 finish，请选 direct');
          if (state.stage === 'assessment' && proposal.mode === 'direct') issues.push('已有 DAG，必须 finish、blocked 或提供剩余 DAG');
          if (proposal.mode === 'finish' && state.tasks.some(t => state.results[t.id]?.status !== 'completed')) {
            issues.push('任务仍失败或未完成，不能 finish');
          }
          if (proposal.mode === 'dag') {
            if (!proposal.tasks.length) issues.push('DAG 至少包含一个工作包');
            if (state.version >= maxReplans + 1) issues.push('重规划预算已耗尽，应报告 blocked');
            issues.push(...validateDag(proposal.tasks, succeeded.map(t => t.id)));
            for (const task of proposal.tasks) issues.push(...validateTaskPolicy(task, policy));
          }
          if (issues.length) throw new Error(issues.join('；'));
          const tasks = proposal.mode === 'dag' ? [...succeeded, ...proposal.tasks] : state.tasks;
          const version = proposal.mode === 'dag' ? state.version + 1 : state.version;
          emit({ runId: state.runId, event: 'plan_committed', version, mode: proposal.mode, tasks,
            message: proposal.rationale });
          return {
            mode: proposal.mode, rationale: proposal.rationale, tasks, version,
            results: new Overwrite(proposal.mode === 'dag'
              ? Object.fromEntries(succeeded.map(t => [t.id, state.results[t.id]!]))
              : state.results),
          };
        } catch (error) {
          if (config.signal?.aborted) throw error;
          lastError = error instanceof Error ? error.message : String(error);
          emit({ runId: state.runId, event: 'plan_rejected', version: state.version, message: lastError });
          if (error instanceof PlanningModelError) {
            return { mode: 'blocked' as const, rationale: lastError, planningError: true };
          }
        }
      }
      return { mode: 'blocked' as const, rationale: `规划失败：${lastError}` };
    })
    .addNode('dispatch', () => ({}))
    .addNode('collect', () => ({}))
    .addNode('worker', async (input: State & { currentTask: TaskSpec }) => {
      const config = getConfig();
      const task = input.currentTask;
      emit({ runId: input.runId, event: 'worker_started', version: input.version, taskId: task.id, task });
      let result: TaskResult;
      let files: FileDelta = {};
      try {
        const outcome = await hooks.work(task, {
          messages: [], files: input.files ?? {},
          dependencyResults: Object.fromEntries(task.dependencies.map(d => [d, input.results[d]!])),
        }, { ...config, tags: [...(config.tags ?? []), 'nostream'],
          metadata: { ...config.metadata, autonomous_task_id: task.id } });
        result = taskResultSchema.parse(outcome.result);
        if (result.status === 'completed' && !result.evidence.length) {
          result = { ...result, status: 'failed', summary: 'Worker 声称完成，但未提供验收证据' };
        }
        files = outcome.files ?? {};
      } catch (error) {
        if (config.signal?.aborted) throw error;
        result = { status: 'failed', summary: error instanceof Error ? error.message : String(error), evidence: [], artifacts: [] };
      }
      emit({ runId: input.runId, event: result.status === 'completed' ? 'worker_completed' : 'worker_failed',
        version: input.version, taskId: task.id, result });
      return { results: { [task.id]: result }, files };
    })
    .addNode('assess', state => {
      emit({ runId: state.runId, event: 'assessment', version: state.version });
      return { stage: 'assessment' as const };
    })
    .addNode('direct', async (state) => {
      const output = await hooks.direct(executionContext(state), getConfig());
      if (!output.messages.length) throw new Error('直接执行未返回回答');
      emit({ runId: state.runId, event: 'finalized', version: state.version, status: 'completed' });
      return { messages: output.messages, files: output.files ?? {} };
    })
    .addNode('finalize', async (state) => {
      let status: 'completed' | 'blocked' = state.mode === 'finish' ? 'completed' : 'blocked';
      let message: BaseMessage;
      try {
        message = state.planningError ? new AIMessage(`运行已阻塞。${state.rationale}`)
          : await hooks.finalize({ ...state, status, reason: state.rationale }, getConfig());
      } catch (error) {
        if (getConfig().signal?.aborted) throw error;
        status = 'blocked';
        message = new AIMessage(`运行已阻塞，无法生成最终汇总：${error instanceof Error ? error.message : String(error)}。任务执行记录已保留，不能据此认定目标已验收。`);
      }
      emit({ runId: state.runId, event: 'finalized', version: state.version, status });
      return { messages: [message], mode: status === 'completed' ? 'finish' as const : 'blocked' as const };
    })
    .addEdge(START, 'initialize')
    .addEdge('initialize', 'plan')
    .addConditionalEdges('plan', state => state.mode === 'dag' ? 'dispatch' : state.mode === 'direct' ? 'direct' : 'finalize',
      ['dispatch', 'direct', 'finalize'])
    .addConditionalEdges('dispatch', state => {
      const ready = selectReadyTasks(state.tasks, state.results, concurrency);
      return ready.length ? ready.map(currentTask => new Send('worker', { ...state, currentTask })) : 'assess';
    }, ['worker', 'assess'])
    .addEdge('worker', 'collect')
    .addConditionalEdges('collect', state => {
      // All workers in this superstep settle before the next dispatch; failures return to planning.
      if (Object.values(state.results).some(r => r.status !== 'completed')) return 'assess';
      return selectReadyTasks(state.tasks, state.results, concurrency).length ? 'dispatch' : 'assess';
    }, ['dispatch', 'assess'])
    .addEdge('assess', 'plan')
    .addEdge('direct', END)
    .addEdge('finalize', END);

  return graph.compile({ checkpointer: new MemorySaver() });
}
