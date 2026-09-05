import { validateDag, type TaskSpec } from './task-plan.ts';
import type { OrchestrationEvent } from './workflow.ts';

/** Checks scheduler facts, not task quality. Domain-specific correctness needs its own oracle. */
export function verifyAutonomyEvents(events: OrchestrationEvent[], options: {
  requireParallel?: boolean; expectedStatus?: 'completed' | 'blocked';
} = {}) {
  const errors: string[] = [];
  const active = new Map<string, TaskSpec>();
  const completed = new Set<string>();
  const attempts = new Set<string>();
  let tasks: TaskSpec[] = [];
  let runId = '';
  let version = 0;
  let mode = '';
  let finalized = false;
  let limit = 1;
  let maximumConcurrency = 0;
  let workerCount = 0;
  let replanCount = 0;
  let failedAttempts = 0;
  for (const event of events) {
    if (event.event === 'run_started') {
      if (runId) errors.push('一次报告只能包含一次运行');
      runId = event.runId;
      limit = event.concurrency ?? 1;
    } else if (!runId || event.runId !== runId) errors.push('事件缺少匹配的运行');
    if (finalized) errors.push('结束后仍有执行事件');
    if (event.event === 'plan_committed') {
      if (active.size) errors.push('旧任务尚未结束就提交新计划');
      mode = event.mode ?? '';
      if (mode === 'dag') {
        if (event.version !== version + 1) errors.push('DAG 版本未递增');
        if (version > 0) replanCount++;
        version = event.version;
        tasks = event.tasks ?? [];
        if (!tasks.length) errors.push('空 DAG');
        errors.push(...validateDag(tasks));
        if ([...completed].some(id => !tasks.some(t => t.id === id))) errors.push('重规划丢失已完成任务');
      }
    } else if (event.event === 'worker_started') {
      const task = tasks.find(t => t.id === event.taskId);
      const key = `${event.version}:${event.taskId}`;
      if (!task || mode !== 'dag' || event.version !== version) {
        errors.push('执行了未提交计划中的任务');
        continue;
      }
      if (attempts.has(key) || completed.has(task.id)) errors.push('重复执行任务');
      attempts.add(key);
      if (task.dependencies.some(d => !completed.has(d))) errors.push(`依赖未完成：${task.id}`);
      if (active.size && (task.access !== 'read' || [...active.values()].some(t => t.access !== 'read'))) {
        errors.push('写入或有副作用的任务与其他任务重叠');
      }
      active.set(key, task);
      workerCount++;
      maximumConcurrency = Math.max(maximumConcurrency, active.size);
      if (active.size > limit) errors.push('执行并发超过上限');
    } else if (event.event === 'worker_completed' || event.event === 'worker_failed') {
      const key = `${event.version}:${event.taskId}`;
      if (!active.delete(key)) errors.push('任务结束事件没有匹配的启动');
      if (event.event === 'worker_completed') {
        if (event.result?.status !== 'completed' || !event.result.evidence.length) errors.push('成功任务缺少证据');
        completed.add(event.taskId!);
      } else failedAttempts++;
    } else if (event.event === 'finalized') {
      finalized = true;
      if (active.size) errors.push('结束时仍有运行中的任务');
      if (event.status !== (options.expectedStatus ?? 'completed')) errors.push(`运行状态为 ${event.status}`);
      if (event.status === 'completed' && mode !== 'direct') {
        if (mode !== 'finish') errors.push('没有主 Agent 验收决策');
        if (tasks.some(t => !completed.has(t.id))) errors.push('当前 DAG 还有未完成任务');
      }
    }
  }
  if (!runId || !finalized) errors.push('运行未正常收敛');
  if (active.size) errors.push('存在未结束的 Worker');
  if (options.requireParallel && maximumConcurrency < 2) errors.push('此独立工作包场景未产生实际并行');
  return { passed: errors.length === 0, workerCount, maximumConcurrency, replanCount,
    failedAttempts, allWorkersSettled: active.size === 0, errors: [...new Set(errors)] };
}
