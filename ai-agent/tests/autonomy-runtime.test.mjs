import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { createAutonomousRuntime } from '../src/core/autonomy/runtime.ts';
import { taskSpecSchema } from '../src/core/autonomy/task-plan.ts';
import { verifyAutonomyEvents } from '../src/core/autonomy/verification.ts';

class ScriptedModel extends BaseChatModel {
  constructor(respond) { super({}); this.respond = respond; }
  _llmType() { return 'scripted-autonomy-test'; }
  bindTools(tools) { return this.withConfig({ testTools: tools.map(t => t.name) }); }
  async _generate(messages, options) {
    const message = await this.respond(messages, options);
    return { generations: [{ text: String(message.content), message }] };
  }
  async *_streamResponseChunks(messages, options, manager) {
    const { generations } = await this._generate(messages, options);
    const message = generations[0].message;
    const chunk = new AIMessageChunk({ content: message.content, id: randomUUID(), tool_calls: message.tool_calls });
    const generation = new ChatGenerationChunk({ text: String(message.content), message: chunk });
    yield generation;
    await manager?.handleLLMNewToken(String(message.content), undefined, undefined, undefined, undefined, { chunk: generation });
  }
}
const call = (name, args, content = 'INTERNAL') => new AIMessage({ content, tool_calls: [{ name, args, id: randomUUID(), type: 'tool_call' }] });
const spec = taskSpecSchema.parse({ id: 'produce', title: '产物', role: '动态文件作者', objective: '写文件',
  successCriteria: ['产物存在'], access: 'write', capabilities: ['filesystem_write'], writeScopes: ['/work'] });
const completed = { status: 'completed', summary: '写入完成', evidence: ['/work/a.txt 内容为 verified'], artifacts: ['/work/a.txt'] };

test('real kernel integrates file tool, policy, structured completion, checkpoint and UI stream', async () => {
  const events = [];
  let plans = 0;
  let workerCalls = 0;
  let tokens = 0;
  const model = new ScriptedModel((_messages, options) => {
    if (options.testTools?.includes('plan_tasks')) return call('plan_tasks', plans++ === 0
      ? { mode: 'dag', rationale: '需要产物', tasks: [spec] }
      : { mode: 'finish', rationale: '已核验', tasks: [] });
    return new AIMessage('FINAL_ANSWER');
  });
  const runtime = createAutonomousRuntime({ model, workerModel: () => new ScriptedModel((_messages, options) => {
    assert.ok(options.testTools.includes('write_file'));
    assert.ok(!options.testTools.includes('execute'));
    return workerCalls++ === 0
      ? call('write_file', { file_path: '/work/a.txt', content: 'verified' })
      : call('submit_task_result', completed);
  }), tools: [], systemPrompt: 'test', shellEnabled: false, maxConcurrency: 2, maxRetries: 0, onEvent: e => events.push(e) });
  const config = { configurable: { thread_id: randomUUID() }, streamMode: ['messages', 'tools'],
    callbacks: [{ handleLLMNewToken: () => { tokens++; } }] };
  const stream = await runtime.stream({ messages: [{ role: 'user', content: 'write' }] }, config);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const messages = chunks.filter(c => c[0] === 'messages').map(c => String(c[1][0].content)).join('');
  assert.equal(messages, 'FINAL_ANSWER', JSON.stringify(chunks.filter(c => c[0] === 'messages')));
  assert.ok(tokens > 0, 'liveness callbacks must propagate');
  const traces = chunks.filter(c => c[0] === 'tools').map(c => c[1]);
  assert.ok(traces.some(t => t.name === 'task' && t.event === 'on_tool_end'));
  assert.ok(traces.some(t => t.name === 'plan_tasks'));
  const snapshot = await runtime.getState(config);
  assert.equal(snapshot.values.files['/work/a.txt'].content, 'verified');
  assert.equal(snapshot.values.messages.at(-1).content, 'FINAL_ANSWER');
  assert.equal(verifyAutonomyEvents(events).passed, true);
});

test('direct route streams answer and no task events', async () => {
  const model = new ScriptedModel((_messages, options) => options.testTools?.includes('plan_tasks')
    ? call('plan_tasks', { mode: 'direct', rationale: '简单请求', tasks: [] }) : new AIMessage('391'));
  const runtime = createAutonomousRuntime({ model, workerModel: () => { throw new Error('unexpected worker'); },
    tools: [], systemPrompt: 'test', shellEnabled: false, maxConcurrency: 2, maxRetries: 0 });
  const stream = await runtime.stream({ messages: [{ role: 'user', content: '17*23' }] }, { configurable: { thread_id: randomUUID() } });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  assert.equal(chunks.filter(c => c[0] === 'messages').map(c => c[1][0].content).join(''), '391');
  assert.equal(chunks.some(c => c[0] === 'tools' && c[1].name === 'task'), false);
});

test('planning emits progress before a slow model responds, and abort prevents workers', async () => {
  const controller = new AbortController();
  let workerCalls = 0;
  const model = new ScriptedModel(async (_messages, options) => {
    await new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(options.signal.reason);
      options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    throw new Error('unreachable');
  });
  const runtime = createAutonomousRuntime({ model, workerModel: () => { workerCalls++; return model; },
    tools: [], systemPrompt: 'test', shellEnabled: false, maxConcurrency: 2, maxRetries: 0 });
  const stream = await runtime.stream({ messages: [{ role: 'user', content: 'complex research' }] },
    { configurable: { thread_id: randomUUID() }, signal: controller.signal });
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.value[1].name, 'plan_tasks');
  assert.equal(first.value[1].event, 'on_tool_start');
  controller.abort();
  await assert.rejects(async () => { for await (const _ of iterator) {} });
  assert.equal(workerCalls, 0);
});

test('public Tavily tool produces one named lifecycle without nested unknown polls', async t => {
  const { createSystemToolCatalog } = await import('../src/plugins/builtin-tools.ts');
  const oldKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'test-only';
  t.after(() => { oldKey === undefined ? delete process.env.TAVILY_API_KEY : process.env.TAVILY_API_KEY = oldKey; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [{ url: 'https://example.com' }] }));
  let rounds = 0;
  const model = new ScriptedModel((_messages, options) => options.testTools?.includes('plan_tasks')
    ? call('plan_tasks', { mode: 'direct', rationale: '单次查询', tasks: [] })
    : rounds++ === 0 ? call('tavily_search', { query: 'population' }) : new AIMessage('answer'));
  const runtime = createAutonomousRuntime({ model, workerModel: () => model,
    tools: [createSystemToolCatalog().tavily_search], systemPrompt: 'test', shellEnabled: false, maxConcurrency: 2, maxRetries: 0 });
  const stream = await runtime.stream({ messages: [{ role: 'user', content: 'search' }] },
    { configurable: { thread_id: randomUUID() } });
  const events = [];
  for await (const item of stream) if (item[0] === 'tools') events.push(item[1]);
  assert.equal(events.some(e => e.name === 'unknown'), false, JSON.stringify(events));
  const search = events.filter(e => e.name === 'tavily_search');
  assert.equal(search.length, 2, JSON.stringify(events));
  assert.equal(search[0].toolCallId, search[1].toolCallId);
});
