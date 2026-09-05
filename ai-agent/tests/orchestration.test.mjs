import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createAutonomousWorkflow, PlanningModelError, fileDelta } from '../src/core/autonomy/workflow.ts';
import { taskSpecSchema, validateDag } from '../src/core/autonomy/task-plan.ts';
import { createCapabilityPolicy, createWorkerPolicy, validateTaskPolicy, pathWithin } from '../src/core/autonomy/policy.ts';
import { verifyAutonomyEvents } from '../src/core/autonomy/verification.ts';
import { isTransientSubagentError } from '../src/core/orchestration.ts';

const task = (id, dependencies = [], extra = {}) => taskSpecSchema.parse({
  id, title: id, role: `本次负责 ${id}`, objective: `完成 ${id}`, dependencies,
  successCriteria: ['有可核验证据'], ...extra,
});
const result = (summary = '已核验') => ({ status: 'completed', summary, evidence: [summary], artifacts: [] });
const decision = (mode, tasks = []) => ({ mode, tasks, rationale: '根据当前目标和证据决定' });
const policy = createCapabilityPolicy([], false);
function fixture(tasks, overrides = {}, options = {}) {
  const events = [];
  const hooks = {
    plan: async c => decision(c.stage === 'initial' ? 'dag' : 'finish', c.stage === 'initial' ? tasks : []),
    work: async () => { await delay(5); return { result: result() }; },
    direct: async () => ({ messages: [new AIMessage('直接回答')] }),
    finalize: async c => new AIMessage(c.status),
    ...overrides,
  };
  const graph = createAutonomousWorkflow({ hooks, policy, onEvent: e => events.push(e), ...options });
  const config = { configurable: { thread_id: randomUUID() }, recursionLimit: 150 };
  return { graph, config, events, run: (input = {}) => graph.invoke({ messages: [new HumanMessage('请完成任务')], ...input }, config) };
}

test('validates IDs, unknown dependencies, self edges and cycles', () => {
  assert.deepEqual(validateDag([task('a'), task('b', ['a'])]), []);
  for (const tasks of [[task('a'), task('a')], [task('a', ['missing'])], [task('a', ['a'])], [task('a', ['b']), task('b', ['a'])]]) {
    assert.ok(validateDag(tasks).length);
  }
  assert.ok(validateDag([task('a')], ['a']).length);
  assert.ok(validateDag([task('constructor')]).length);
});

test('four independent tasks run in two actual batches; synthesis sees all four results', async () => {
  const tasks = ['a', 'b', 'c', 'd'].map(id => task(id));
  tasks.push(task('synthesis', ['a', 'b', 'c', 'd']));
  let count = 0;
  const f = fixture(tasks, { work: async (t, c) => {
    count++;
    if (t.id === 'synthesis') assert.equal(Object.keys(c.dependencyResults).length, 4);
    await delay(10);
    return { result: result(t.id) };
  } });
  const output = await f.run();
  assert.equal(count, 5);
  assert.equal(Object.keys(output.results).length, 5);
  const report = verifyAutonomyEvents(f.events, { requireParallel: true });
  assert.deepEqual(report.errors, []);
  assert.equal(report.maximumConcurrency, 2);
});

test('a serial DAG is valid, not a failed parallelism test', async () => {
  const f = fixture([task('a'), task('b', ['a']), task('c', ['b'])]);
  await f.run();
  const report = verifyAutonomyEvents(f.events);
  assert.equal(report.passed, true);
  assert.equal(report.maximumConcurrency, 1);
});

test('write workers are exclusive even for overlapping paths', async () => {
  const write = { access: 'write', capabilities: ['filesystem_write'], writeScopes: ['/workspace'] };
  const f = fixture([task('a', [], write), task('b', [], write), task('c')], {}, { maxConcurrency: 4 });
  await f.run();
  const report = verifyAutonomyEvents(f.events);
  assert.deepEqual(report.errors, []);
  assert.equal(report.maximumConcurrency, 1);
});

test('failure returns to planner, preserves successes, and does not start dependent work', async () => {
  const called = [];
  const f = fixture([], {
    plan: async c => {
      if (c.stage === 'initial') return decision('dag', [task('ok'), task('bad'), task('old_join', ['bad'])]);
      if (c.version === 1) {
        assert.equal(c.results.ok.status, 'completed');
        assert.equal(c.results.bad.status, 'failed');
        return decision('dag', [task('alternative', ['ok']), task('new_join', ['alternative'])]);
      }
      return decision('finish');
    },
    work: async t => { called.push(t.id); if (t.id === 'bad') throw new Error('simulated failure'); return { result: result() }; },
  });
  await f.run();
  assert.deepEqual(called, ['ok', 'bad', 'alternative', 'new_join']);
  const report = verifyAutonomyEvents(f.events);
  assert.deepEqual(report.errors, []);
  assert.equal(report.replanCount, 1);
  assert.equal(report.failedAttempts, 1);
});

test('invalid plan is rejected before execution and can be corrected', async () => {
  let calls = 0;
  const f = fixture([], { plan: async c => {
    if (c.stage === 'assessment') return decision('finish');
    return decision('dag', [task('a', calls++ === 0 ? ['missing'] : [])]);
  } });
  await f.run();
  assert.equal(f.events.filter(e => e.event === 'plan_rejected').length, 1);
  assert.equal(verifyAutonomyEvents(f.events).passed, true);
});

test('replan budget terminates honestly as blocked', async () => {
  const f = fixture([], {
    plan: async () => decision('dag', [task('bad')]),
    work: async () => { throw new Error('permanent failure'); },
  }, { maxReplans: 1 });
  const output = await f.run();
  assert.equal(output.mode, 'blocked');
  assert.equal(f.events.filter(e => e.event === 'worker_started').length, 2);
  assert.equal(verifyAutonomyEvents(f.events, { expectedStatus: 'blocked' }).passed, true);
});

test('cannot finish while tasks remain failed; empty evidence is failure', async () => {
  const f = fixture([task('a')], { work: async () => ({ result: { ...result(), evidence: [] } }) });
  const output = await f.run();
  assert.equal(output.results.a.status, 'failed');
  assert.equal(output.mode, 'blocked');
});

test('direct answers use no workers and next turn resets orchestration state', async () => {
  let turns = 0;
  const f = fixture([task('a')], { plan: async c => {
    if (c.stage === 'assessment') return decision('finish');
    return turns++ === 0 ? decision('dag', [task('a')]) : decision('direct');
  } });
  await f.run();
  const output = await f.run();
  assert.equal(output.mode, 'direct');
  assert.deepEqual(output.tasks, []);
  assert.deepEqual(output.results, {});
  assert.equal(output.messages.length, 4);
  const snapshot = await f.graph.getState(f.config);
  assert.equal(snapshot.values.mode, 'direct');
});

test('file deltas do not overwrite another worker result and deletes propagate', () => {
  const before = { '/a': { content: 'a' }, '/b': { content: 'b' } };
  assert.deepEqual(fileDelta(before, { ...before, '/a': { content: 'new' } }), { '/a': { content: 'new' } });
  assert.deepEqual(fileDelta(before, { '/a': before['/a'] }), { '/b': null });
});

test('worker middleware rejects forbidden tools and write path escapes before executing', async () => {
  const t = task('writer', [], { access: 'write', capabilities: ['filesystem_write'], writeScopes: ['/workspace/a'] });
  const middleware = createWorkerPolicy(t, policy);
  let calls = 0;
  const invoke = (name, file_path) => middleware.wrapToolCall({ toolCall: { name, args: { file_path } } }, async () => { calls++; });
  await invoke('write_file', '/workspace/a/index.ts');
  await assert.rejects(invoke('write_file', '/workspace/ab/index.ts'), /越界/);
  await assert.rejects(invoke('write_file', '/workspace/a/../secret'), /越界/);
  await assert.rejects(invoke('execute'), /无权/);
  assert.equal(calls, 1);
  assert.equal(pathWithin('/skills/a', ['/skills']), false);
  assert.ok(validateTaskPolicy(task('x', [], { capabilities: ['not_enabled'] }), policy).length);
  assert.ok(validateTaskPolicy(task('x', [], { capabilities: ['toString'] }), policy).length);
  assert.throws(() => createCapabilityPolicy([{ name: 'execute' }], true), /冲突/);
  assert.ok(validateTaskPolicy(task('x', [], { capabilities: ['filesystem_write'] }), policy).length);
});

test('cancellation propagates to workers and never emits successful finalization', async () => {
  const controller = new AbortController();
  const f = fixture([task('a'), task('b', ['a'])], { work: async (_t, _c, config) => {
    controller.abort(new Error('test cancelled'));
    config.signal.throwIfAborted();
  } });
  await assert.rejects(f.graph.invoke({ messages: [new HumanMessage('run')] }, { ...f.config, signal: controller.signal }));
  assert.equal(f.events.some(e => e.event === 'finalized'), false);
  assert.equal(f.events.some(e => e.taskId === 'b'), false);
});

test('trace verifier rejects fabricated concurrency, premature dependencies and dangling starts', async () => {
  const f = fixture([task('a'), task('b', ['a'])]);
  await f.run();
  const corrupt = f.events.filter(e => !(e.event === 'worker_completed' && e.taskId === 'a'));
  const report = verifyAutonomyEvents(corrupt);
  assert.equal(report.passed, false);
  assert.ok(report.errors.some(e => e.includes('依赖未完成')));
  assert.equal(report.allWorkersSettled, false);
});

test('only transient model errors are retried, not auth/schema/abort failures', () => {
  assert.equal(isTransientSubagentError(new Error('terminated')), true);
  assert.equal(isTransientSubagentError(Object.assign(new Error('request'), { status: 429 })), true);
  assert.equal(isTransientSubagentError(Object.assign(new Error('timeout invalid key'), { status: 401 })), false);
  assert.equal(isTransientSubagentError(Object.assign(new Error('timeout'), { name: 'AbortError' })), false);
  assert.equal(isTransientSubagentError(new Error('invalid schema')), false);
});

test('provider refusal is not retried as invalid planning and finalizes without another API call', async () => {
  let requests = 0;
  const f = fixture([], {
    plan: async () => { requests++; throw new PlanningModelError(Object.assign(new Error('quota exhausted'), { status: 402 })); },
    finalize: async () => { throw new Error('must not call provider again'); },
  });
  const output = await f.run();
  assert.equal(requests, 1);
  assert.match(output.messages.at(-1).content, /quota exhausted/);
  assert.equal(verifyAutonomyEvents(f.events, { expectedStatus: 'blocked' }).passed, true);
});
