import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { tool, type StructuredTool } from '@langchain/core/tools';
import {
  createAgent, createMiddleware, todoListMiddleware, modelCallLimitMiddleware,
  type AgentMiddleware,
} from 'langchain';
import {
  createFilesystemMiddleware, createSkillsMiddleware, createSummarizationMiddleware,
  createPatchToolCallsMiddleware, StateBackend, type AnyBackendProtocol, type BackendRuntime,
} from 'deepagents';
import { createSubagentModelRetryMiddleware } from '../orchestration.ts';
import { createCapabilityPolicy, createWorkerPolicy, allowedTaskTools } from './policy.ts';
import { planDecisionSchema, taskResultSchema, type TaskSpec, type TaskResult } from './task-plan.ts';
import { createAutonomousWorkflow, PlanningModelError, fileDelta, type Files, type WorkflowHooks, type OrchestrationEvent } from './workflow.ts';

export interface AutonomousRuntimeOptions {
  model: BaseChatModel;
  workerModel: (maxTokens: number) => BaseChatModel;
  tools: StructuredTool[];
  systemPrompt: string;
  backend?: AnyBackendProtocol;
  skills?: string[];
  shellEnabled: boolean;
  maxConcurrency: number;
  maxRetries: number;
  maxReplans?: number;
  directMiddleware?: AgentMiddleware[];
  workerMiddleware?: (task: TaskSpec) => AgentMiddleware[];
  validateWritePath?: (path: string) => Promise<void>;
  onEvent?: (event: OrchestrationEvent) => void;
}

const PLANNING_PROMPT = [
  '你负责当前目标的规划和验收决策。调用 plan_tasks 提交结构化决策。',
  '首次规划：简单或紧耦合工作选择 direct；从隔离上下文、分阶段或并行工作中受益时选择 dag；缺少必要信息或能力时选择 blocked 并说明。',
  '不要为了展示多 Agent 拆分任务。任务数、角色和依赖根据实际目标决定。role 为自由文本职责，不是职业枚举。',
  '独立工作包不要虚构依赖；只有需要前置结果的任务才填写 dependencies。可以先委派探索，获得证据后再规划剩余工作。',
  '每个 Worker 看不到用户对话。请把用户约束、文件位置、必要背景明确填进 context，并给出可检验的 successCriteria。',
  '不允许角色提升权限。capabilities 只能来自运行时公布的清单。纯思考无需工具；读文件选 filesystem_read，写文件另加 filesystem_write 和具体 writeScopes。',
  '只读工作选 read；写文件选 write；shell 和有副作用的外部工具必须 exclusive。execute 只能在沙箱内运行，必须授权 /mnt/user-data。',
  '不要把向用户汇总作为 Worker，最终答复由主 Agent 完成。若任务确需集成、测试、独立复核，才把它们加入 DAG。',
  '验收阶段：逐项检查返回的证据是否满足用户目标。全部满足选 finish；失败、遗漏或证据不足则提交只含剩余工作的 dag，并解释替代关系。',
  '成功任务和证据由运行时保留，禁止用相同 ID 覆盖。新任务可依赖成功 ID；失败任务可缩小或替换。',
  '失败不代表副作用已回滚。重新执行写文件、shell 或外部操作前，先核对已有产物和实际状态，避免重复写入或重复提交。',
  '验收阶段不能选择 direct；未完成任务不能选 finish。缺权限、达到重规划上限或无法继续时选择 blocked。',
].join('\n');

export function createAutonomousRuntime(options: AutonomousRuntimeOptions) {
  const policy = createCapabilityPolicy(options.tools, options.shellEnabled);
  const planningTool = tool(input => JSON.stringify(input), {
    name: 'plan_tasks', description: '选择直接执行，或提交动态任务 DAG，或验收完成/报告阻塞。', schema: planDecisionSchema,
  });
  const planner = options.model.bindTools!([planningTool], { tool_choice: 'auto' });

  function kernel(tools: StructuredTool[], middleware: AgentMiddleware[], task?: TaskSpec) {
    const allowed = task ? allowedTaskTools(task, policy) : undefined;
    const fsNames = ['read_file', 'ls', 'glob', 'grep', 'write_file', 'edit_file', 'delete', 'execute'] as const;
    // read_file is required by FilesystemMiddleware; tool policy still checks it on each call.
    const fsTools = allowed ? fsNames.filter(n => n === 'read_file' || allowed.has(n)) : undefined;
    return createAgent({
      model: task ? options.workerModel(task.maxTokens) : options.model,
      tools,
      systemPrompt: options.systemPrompt,
      middleware: [
        createFilesystemMiddleware({ backend: options.backend, tools: fsTools }),
        ...(options.skills?.length ? [createSkillsMiddleware({ backend: options.backend ?? ((runtime: BackendRuntime) => new StateBackend(runtime)), sources: options.skills })] : []),
        createSummarizationMiddleware({ backend: options.backend ?? ((runtime: BackendRuntime) => new StateBackend(runtime)) }),
        createPatchToolCallsMiddleware(),
        modelCallLimitMiddleware({ runLimit: task ? 16 : 32, exitBehavior: 'error' }),
        ...middleware,
      ],
    });
  }

  const hooks: WorkflowHooks = {
    async plan(context, config) {
      const catalog = Object.entries(policy.tools).map(([name, entry]) => ({
        name, effect: entry.effect,
        description: options.tools.find(t => t.name === name)?.description,
      }));
      const response = await planner.invoke([
        new SystemMessage(`${options.systemPrompt}\n${PLANNING_PROMPT}\n能力清单：${JSON.stringify(catalog)}`),
        ...context.messages,
        new HumanMessage(JSON.stringify({
          stage: context.stage, version: context.version,
          maxReplans: options.maxReplans ?? 2,
          tasks: context.tasks, results: context.results,
        })),
      ], config).catch(error => { throw new PlanningModelError(error); });
      const calls = response.tool_calls?.filter(c => c.name === 'plan_tasks');
      if (calls?.length !== 1) throw new Error('规划模型必须调用一次 plan_tasks');
      return planDecisionSchema.parse(calls[0]!.args);
    },
    async work(task, context, config) {
      let submitted: TaskResult | undefined;
      const completion = tool(input => {
        submitted = taskResultSchema.parse(input);
        return '结果已提交';
      }, { name: 'submit_task_result', description: '完成当前工作包后提交结果及逐项验收证据；无法完成应返回 failed/blocked。', schema: taskResultSchema });
      const stopAfterSubmit = createMiddleware({
        name: 'workerCompletion',
        wrapModelCall: async (request, handler) => {
          if (submitted) return new AIMessage(JSON.stringify(submitted));
          const response = await handler(request);
          if (response.tool_calls?.some(c => c.name === 'submit_task_result') && response.tool_calls.length !== 1) {
            throw new Error('submit_task_result 必须在其他操作结束后单独提交');
          }
          if (task.access !== 'read' && (response.tool_calls?.length ?? 0) > 1) {
            throw new Error('有副作用的 Worker 每轮只能执行一个工具，禁止 shell 与文件操作并行竞争');
          }
          return response;
        },
      });
      const worker = kernel([...options.tools, completion], [
        createSubagentModelRetryMiddleware(options.maxRetries),
        createWorkerPolicy(task, policy, options.validateWritePath), ...(options.workerMiddleware?.(task) ?? []), stopAfterSubmit,
      ], task);
      const prompt = [
        '你是一个通用执行 Worker。以下任务规格决定本次临时职责，不能扩大权限或改变用户约束。',
        JSON.stringify({ task, dependencyResults: context.dependencyResults }),
        '逐项执行并检查 successCriteria。结束必须调用 submit_task_result，提供实际证据，不要只口头声称完成。',
        '若缺少工具、上下文或验收失败，返回 failed/blocked，供协调者重规划。只负责当前工作包。',
        'write/exclusive 任务每轮只调用一个工具，不得把 shell 和文件操作放在同一轮并行执行。',
      ].join('\n');
      const output = await worker.invoke({ messages: [new HumanMessage(prompt)], files: context.files }, {
        ...config, recursionLimit: 64,
      });
      return {
        result: submitted ?? { status: 'failed', summary: 'Worker 未提交结构化验收结果', evidence: [], artifacts: [] },
        files: fileDelta(context.files, (output.files ?? {}) as Files),
      };
    },
    async direct(context, config) {
      const agent = kernel(options.tools, [todoListMiddleware(), ...(options.directMiddleware ?? [])]);
      const output = await agent.invoke({ messages: context.messages, files: context.files }, { ...config, recursionLimit: 100 });
      return {
        messages: output.messages.slice(context.messages.length),
        files: fileDelta(context.files, (output.files ?? {}) as Files),
      };
    },
    async finalize(context, config) {
      return options.model.invoke([
        new SystemMessage(`${options.systemPrompt}\n请根据已执行任务及验收状态回复用户。只能引用证据支持的成果；blocked 时说明缺少条件和未完成部分。`),
        ...context.messages,
        new HumanMessage(JSON.stringify({ status: context.status, reason: context.reason, tasks: context.tasks, results: context.results })),
      ], config);
    },
  };
  const graph = createAutonomousWorkflow({ ...options, policy, hooks });

  // Preserve the existing CLI/Web stream contract. Scheduler events come from actual
  // graph node execution; internal planner/worker prose never becomes the final answer.
  return {
    graph,
    getState: (config: Record<string, unknown>) => graph.getState(config),
    async stream(input: Record<string, unknown>, config: Record<string, unknown> = {}) {
      const modes = Array.isArray(config.streamMode) ? config.streamMode as string[] : ['messages', 'tools'];
      const stream = await graph.stream(input, {
        ...config, recursionLimit: 150, streamMode: [...new Set([...modes, 'custom'])] as ('messages' | 'tools' | 'custom')[],
      });
      return (async function* () {
        for await (const item of stream) {
          if (!Array.isArray(item)) continue;
          if (item[0] === 'messages') {
            const metadata = item[1]?.[1];
            if (metadata?.tags?.includes('nostream') || metadata?.autonomous_task_id || metadata?.langgraph_node === 'plan') continue;
          }
          if (item[0] !== 'custom') { yield item; continue; }
          const event = item[1]?.autonomy as OrchestrationEvent | undefined;
          if (!event || !modes.includes('tools')) continue;
          const id = `${event.runId}:${event.version}:${event.taskId ?? `plan:${event.mode}`}`;
          if (event.event === 'worker_started') {
            yield ['tools', { event: 'on_tool_start', name: 'task', toolCallId: id,
              input: { role: event.task?.role, objective: event.task?.objective } }];
          } else if (event.event === 'worker_completed' || event.event === 'worker_failed') {
            yield ['tools', { event: event.event === 'worker_completed' ? 'on_tool_end' : 'on_tool_error',
              name: 'task', toolCallId: id, output: event.result, error: event.result?.summary }];
          } else if (event.event === 'plan_committed') {
            yield ['tools', { event: 'on_tool_start', name: 'plan_tasks', toolCallId: id,
              input: { mode: event.mode, tasks: event.tasks } }];
            yield ['tools', { event: 'on_tool_end', name: 'plan_tasks', toolCallId: id, output: event.message }];
          }
        }
      })();
    },
  };
}
