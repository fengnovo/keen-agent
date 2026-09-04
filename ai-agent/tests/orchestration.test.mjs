import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createComplexPlanningMiddleware,
  createOrchestrationSubagents,
  createTaskConcurrencyMiddleware,
  isComplexAgentRequest,
  isTransientSubagentError,
  MULTI_AGENT_ORCHESTRATION_PROMPT,
  verifyOrchestrationEvents,
} from '../src/core/orchestration.ts';

test('registers distinct planning, research, implementation and review roles', () => {
  const subagents = createOrchestrationSubagents([]);

  assert.deepEqual(
    subagents.map((subagent) => subagent.name),
    ['general-purpose', 'planner', 'researcher', 'implementer', 'reviewer'],
  );
  for (const subagent of subagents) {
    assert.ok(subagent.description.length > 20);
    assert.equal(typeof subagent.systemPrompt, 'string');
    assert.equal(subagent.middleware[0].name, 'modelRetryMiddleware');
  }
});

test('gives tool and skill access to roles that execute scoped work', () => {
  const fakeTool = { name: 'search' };
  const fakeModel = { model: 'bounded-subagent-model' };
  const subagents = createOrchestrationSubagents(
    [fakeTool],
    ['/skills/'],
    fakeModel,
  );

  assert.equal(subagents[1].skills, undefined);
  for (const subagent of [subagents[0], ...subagents.slice(2)]) {
    assert.deepEqual(subagent.tools, [fakeTool]);
    assert.deepEqual(subagent.skills, ['/skills/']);
    assert.equal(subagent.model, fakeModel);
  }
  assert.equal(subagents[1].model, fakeModel);
});

test('conservatively distinguishes obvious multi-workstream requests', () => {
  assert.equal(isComplexAgentRequest('介绍一下多租户 SaaS'), false);
  assert.equal(
    isComplexAgentRequest(
      '请设计一个系统迁移方案，分别覆盖数据迁移、权限隔离、灰度发布以及回滚验证，并给出验收标准。',
    ),
    true,
  );
  assert.equal(
    isComplexAgentRequest('请并行分析多个模块并给出统一的评审结论'),
    true,
  );
});

test('retries only transient subagent model failures', () => {
  assert.equal(isTransientSubagentError(new Error('terminated')), true);
  assert.equal(isTransientSubagentError(new Error('socket hang up')), true);
  assert.equal(
    isTransientSubagentError(
      Object.assign(new Error('provider rejected request'), { status: 429 }),
    ),
    true,
  );
  assert.equal(
    isTransientSubagentError(
      Object.assign(new Error('provider rejected request'), { status: 503 }),
    ),
    true,
  );
  assert.equal(
    isTransientSubagentError(
      Object.assign(new Error('invalid api key'), { status: 401 }),
    ),
    false,
  );
  assert.equal(isTransientSubagentError(new Error('invalid tool schema')), false);
});

test('limits actual task execution while allowing calls to be scheduled together', async () => {
  const middleware = createTaskConcurrencyMiddleware(2);
  const releases = [];
  let active = 0;
  let started = 0;
  let maximumConcurrency = 0;
  const handler = async () => {
    active += 1;
    started += 1;
    maximumConcurrency = Math.max(maximumConcurrency, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return {};
  };

  const calls = Array.from({ length: 3 }, (_, index) =>
    middleware.wrapToolCall(
      {
        toolCall: { id: `task-${index}`, name: 'task', args: {} },
        runtime: {},
      },
      handler,
    ),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 2);
  assert.equal(maximumConcurrency, 2);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 3);
  assert.equal(maximumConcurrency, 2);

  while (releases.length > 0) releases.shift()();
  await Promise.all(calls);
  assert.equal(active, 0);
});

test('returns a detectable error result so the parent can recover from a failed task', async () => {
  const middleware = createTaskConcurrencyMiddleware(2);
  const result = await middleware.wrapToolCall(
    {
      toolCall: { id: 'failed-task', name: 'task', args: {} },
      runtime: {},
    },
    async () => {
      throw new Error('provider rejected the request');
    },
  );

  assert.equal(result.status, 'error');
  assert.match(String(result.content), /keen-subagent-error/);
});

test('planning gate exposes only write_todos on an obvious complex first turn', async () => {
  const middleware = createComplexPlanningMiddleware(
    'anthropic',
    'kimi-k3',
  );
  let capturedRequest;
  const systemMessage = {
    concat: (suffix) => ({ suffix }),
  };

  await middleware.wrapModelCall(
    {
      messages: [
        {
          role: 'user',
          content:
            '请设计一个系统迁移方案，分别覆盖数据迁移、权限隔离、灰度发布以及回滚验证，并给出验收标准。',
        },
      ],
      tools: [{ name: 'write_todos' }, { name: 'task' }],
      systemMessage,
    },
    async (request) => {
      capturedRequest = request;
      return { content: '' };
    },
  );

  assert.deepEqual(capturedRequest.tools, [{ name: 'write_todos' }]);
  assert.equal(capturedRequest.toolChoice, 'auto');
  assert.match(capturedRequest.systemMessage.suffix, /只能调用一次 write_todos/);
});

test('planning gate requires delegation after the plan tool result exists', async () => {
  const middleware = createComplexPlanningMiddleware('openai');
  const tools = [{ name: 'write_todos' }, { name: 'task' }];
  let capturedRequest;

  await middleware.wrapModelCall(
    {
      messages: [
        {
          role: 'user',
          content:
            '请设计一个系统迁移方案，分别覆盖数据迁移、权限隔离、灰度发布以及回滚验证，并给出验收标准。',
        },
        { role: 'tool', name: 'write_todos', content: 'ok' },
      ],
      tools,
      systemMessage: { concat: (suffix) => ({ suffix }) },
    },
    async (request) => {
      capturedRequest = request;
      return { content: '' };
    },
  );

  assert.deepEqual(capturedRequest.tools, [{ name: 'task' }]);
  assert.deepEqual(capturedRequest.toolChoice, {
    type: 'function',
    function: { name: 'task' },
  });
  assert.match(capturedRequest.systemMessage.suffix, /本批最多 2 个/);
});

test('planning gate remembers the current user turn without relying on tool metadata', async () => {
  const middleware = createComplexPlanningMiddleware('anthropic', 'kimi-k3');
  const tools = [{ name: 'write_todos' }, { name: 'task' }];
  const request = {
    messages: [
      {
        role: 'user',
        content:
          '请设计一个系统迁移方案，分别覆盖数据迁移、权限隔离、灰度发布以及回滚验证，并给出验收标准。',
      },
    ],
    tools,
    systemMessage: { concat: () => ({}) },
  };
  const captured = [];
  const handler = async (nextRequest) => {
    captured.push(nextRequest);
    return { content: '', tool_calls: [] };
  };

  await middleware.wrapModelCall(request, handler);
  await middleware.wrapModelCall(request, handler);
  await middleware.wrapModelCall(request, handler);

  assert.deepEqual(captured[0].tools, [{ name: 'write_todos' }]);
  assert.deepEqual(captured[1].tools, [{ name: 'task' }]);
  assert.equal(captured[2].tools, tools);
});

test('planning gate restores all tools after a task result exists', async () => {
  const middleware = createComplexPlanningMiddleware('anthropic', 'kimi-k3');
  const tools = [{ name: 'write_todos' }, { name: 'task' }];
  let capturedRequest;

  await middleware.wrapModelCall(
    {
      messages: [
        {
          role: 'user',
          content:
            '请设计一个系统迁移方案，分别覆盖数据迁移、权限隔离、灰度发布以及回滚验证，并给出验收标准。',
        },
        { role: 'tool', name: 'write_todos', content: 'ok' },
        { role: 'tool', name: 'task', content: 'done' },
      ],
      tools,
      systemMessage: { concat: () => undefined },
    },
    async (request) => {
      capturedRequest = request;
      return { content: '' };
    },
  );

  assert.equal(capturedRequest.tools, tools);
});

test('planning gate keeps only one write_todos call from a Kimi response', async () => {
  const middleware = createComplexPlanningMiddleware('anthropic', 'kimi-k3');
  const response = {
    content: '',
    tool_calls: [
      { name: 'write_todos', args: { todos: [] }, id: 'plan-a' },
      { name: 'write_todos', args: { todos: [] }, id: 'plan-b' },
    ],
  };

  const result = await middleware.wrapModelCall(
    {
      messages: [
        {
          role: 'user',
          content:
            '请设计一个系统迁移方案，分别覆盖数据迁移、权限隔离、灰度发布以及回滚验证，并给出验收标准。',
        },
      ],
      tools: [{ name: 'write_todos' }, { name: 'task' }],
      systemMessage: { concat: () => ({}) },
    },
    async () => response,
  );

  assert.deepEqual(result.tool_calls, [response.tool_calls[0]]);
});

test('coordination contract requires planning, dependency-aware parallelism and review', () => {
  assert.match(MULTI_AGENT_ORCHESTRATION_PROMPT, /先调用 write_todos/);
  assert.match(MULTI_AGENT_ORCHESTRATION_PROMPT, /并行发出多个 task 调用/);
  assert.match(MULTI_AGENT_ORCHESTRATION_PROMPT, /互不重叠的文件所有权/);
  assert.match(MULTI_AGENT_ORCHESTRATION_PROMPT, /reviewer 做独立复核/);
});

test('accepts a planned run with overlapping task calls', () => {
  const result = verifyOrchestrationEvents([
    { event: 'on_tool_start', name: 'write_todos', toolCallId: 'plan' },
    { event: 'on_tool_end', name: 'write_todos', toolCallId: 'plan' },
    {
      event: 'on_tool_start',
      name: 'task',
      toolCallId: 'task-a',
      input: { subagent_type: 'researcher' },
    },
    {
      event: 'on_tool_start',
      name: 'task',
      toolCallId: 'task-b',
      input: { subagent_type: 'implementer' },
    },
    { event: 'on_tool_end', name: 'task', toolCallId: 'task-a' },
    { event: 'on_tool_end', name: 'task', toolCallId: 'task-b' },
  ]);

  assert.equal(result.passed, true);
  assert.equal(result.plannedBeforeDelegation, true);
  assert.equal(result.delegatedTaskCount, 2);
  assert.equal(result.maximumTaskConcurrency, 2);
  assert.deepEqual(result.subagentTypes, ['researcher', 'implementer']);
  assert.deepEqual(result.errors, []);
});

test('rejects merely sequential delegation even if two tasks were used', () => {
  const result = verifyOrchestrationEvents([
    { event: 'on_tool_start', name: 'write_todos' },
    { event: 'on_tool_end', name: 'write_todos' },
    { event: 'on_tool_start', name: 'task', toolCallId: 'task-a' },
    { event: 'on_tool_end', name: 'task', toolCallId: 'task-a' },
    { event: 'on_tool_start', name: 'task', toolCallId: 'task-b' },
    { event: 'on_tool_end', name: 'task', toolCallId: 'task-b' },
  ]);

  assert.equal(result.passed, false);
  assert.equal(result.maximumTaskConcurrency, 1);
  assert.match(result.errors.join('\n'), /没有并行重叠/);
});

test('rejects a gracefully settled task whose ToolMessage has error status', () => {
  const result = verifyOrchestrationEvents([
    { event: 'on_tool_start', name: 'write_todos', toolCallId: 'plan' },
    { event: 'on_tool_end', name: 'write_todos', toolCallId: 'plan' },
    { event: 'on_tool_start', name: 'task', toolCallId: 'task-a' },
    { event: 'on_tool_start', name: 'task', toolCallId: 'task-b' },
    {
      event: 'on_tool_end',
      name: 'task',
      toolCallId: 'task-a',
      output: { status: 'error', content: '[keen-subagent-error] failed' },
    },
    { event: 'on_tool_end', name: 'task', toolCallId: 'task-b' },
  ]);

  assert.equal(result.passed, false);
  assert.equal(result.allDelegationsSettled, false);
  assert.match(result.errors.join('\n'), /返回失败结果/);
});
