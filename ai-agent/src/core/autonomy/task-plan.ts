import { z } from 'zod';

export const taskSpecSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  title: z.string().min(1).max(120),
  role: z.string().min(1).max(300).describe('为这个工作包动态定义的职责，不是预设职业名称'),
  objective: z.string().min(1).max(3000),
  context: z.array(z.string().max(2000)).max(16).default([]),
  dependencies: z.array(z.string()).max(16).default([]),
  successCriteria: z.array(z.string().min(1).max(800)).min(1).max(12),
  capabilities: z.array(z.string()).max(30).default(['filesystem_read'])
    .describe('仅可选能力清单中的名称；filesystem_read、filesystem_write、shell 或指定的插件工具名'),
  access: z.enum(['read', 'write', 'exclusive']).default('read')
    .describe('read 无副作用，可并行；write 限文件范围，串行；exclusive 用于 shell 或有副作用的插件，独占工作区'),
  writeScopes: z.array(z.string()).max(16).default([])
    .describe('允许写入的绝对路径或目录前缀，不用 glob；shell 任务必须授权整个 /mnt/user-data'),
  maxTokens: z.number().int().min(1024).max(8192).default(4096),
});

export const planDecisionSchema = z.object({
  mode: z.enum(['direct', 'dag', 'finish', 'blocked']),
  rationale: z.string().min(1).max(3000),
  tasks: z.array(taskSpecSchema).max(12).default([])
    .describe('dag 时给出剩余任务；已完成任务由运行时保留，不得重写；其余模式必须为空'),
});

export const taskResultSchema = z.object({
  status: z.enum(['completed', 'failed', 'blocked']),
  summary: z.string().min(1).max(8000),
  evidence: z.array(z.string().min(1).max(2000)).max(16),
  artifacts: z.array(z.string()).max(20).default([]),
});

export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type PlanDecision = z.infer<typeof planDecisionSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type TaskResults = Record<string, TaskResult>;

export function validateDag(tasks: TaskSpec[], completedIds: string[] = []): string[] {
  const errors: string[] = [];
  const completed = new Set(completedIds);
  const byId = new Map<string, TaskSpec>();
  for (const task of tasks) {
    if (Object.hasOwn(Object.prototype, task.id)) errors.push(`保留任务 ID：${task.id}`);
    if (byId.has(task.id)) errors.push(`重复任务 ID：${task.id}`);
    if (completed.has(task.id)) errors.push(`不得覆盖成功任务：${task.id}`);
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    if (new Set(task.dependencies).size !== task.dependencies.length) errors.push(`重复依赖：${task.id}`);
    for (const dep of task.dependencies) {
      if (dep === task.id) errors.push(`自依赖：${task.id}`);
      else if (!byId.has(dep) && !completed.has(dep)) errors.push(`未知依赖：${task.id} -> ${dep}`);
    }
  }
  const done = new Set(completed);
  for (;;) {
    const ready = tasks.filter(t => !done.has(t.id) && t.dependencies.every(d => done.has(d)));
    if (ready.length === 0) break;
    ready.forEach(t => done.add(t.id));
  }
  if (tasks.some(t => !done.has(t.id))) errors.push('依赖存在环或缺失，无法调度');
  return [...new Set(errors)];
}

/** 给定已验证的 DAG，只有全部前置成功的节点可执行；写任务独占整批。 */
export function selectReadyTasks(tasks: TaskSpec[], results: TaskResults, concurrency: number): TaskSpec[] {
  const ready = tasks.filter(t => !results[t.id] &&
    t.dependencies.every(d => results[d]?.status === 'completed'));
  const first = ready[0];
  if (!first) return [];
  if (first.access !== 'read') return [first];
  return ready.filter(t => t.access === 'read').slice(0, Math.max(1, concurrency));
}
