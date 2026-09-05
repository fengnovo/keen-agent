import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSystemToolCatalog } from '../src/plugins/builtin-tools.ts';
import { pollResearch } from '../src/plugins/tavily-client.ts';

const env = (t, values) => {
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [k,v] of Object.entries(previous)) v === undefined ? delete process.env[k] : process.env[k] = v; });
};

test('parallel workers share search budget and duplicate queries make one HTTP request', async t => {
  env(t, { TAVILY_API_KEY: 'test-only', TAVILY_SEARCH_MAX_CALLS: '2' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; await sleep(10); return Response.json({ results: [{ url: 'https://example.com' }] }); });
  const tools = createSystemToolCatalog();
  const results = await Promise.all(['population', 'population', 'housing', 'income'].map(query => tools.tavily_search.invoke({ query })));
  assert.equal(calls, 2);
  assert.deepEqual(results[0], results[1]);
  assert.match(results[3].error, /上限/);
  await createSystemToolCatalog().tavily_search.invoke({ query: 'next conversation' });
  assert.equal(calls, 3);
});

test('aborting a running tool reaches fetch and prevents future calls', async t => {
  env(t, { TAVILY_API_KEY: 'test-only' });
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let httpSignal;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++; httpSignal = options.signal; started();
    await sleep(60_000, undefined, { signal: options.signal });
    return Response.json({ results: [] });
  });
  const tools = createSystemToolCatalog();
  const pending = tools.tavily_search.invoke({ query: 'population' }, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await ready;
  controller.abort();
  await rejected;
  assert.equal(httpSignal.aborted, true);
  await assert.rejects(tools.tavily_search.invoke({ query: 'housing' }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('research polling stops during its wait without another status request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = pollResearch('research-1', controller.signal, async () => {
    calls++; controller.abort(); return { status: 'in_progress' };
  }, 1);
  await assert.rejects(pending, { name: 'AbortError' });
  await sleep(20);
  assert.equal(calls, 1);
});

test('research is disabled by default and deduplicated when explicitly enabled', async t => {
  env(t, { TAVILY_API_KEY: 'test-only', TAVILY_RESEARCH_MAX_CALLS: '0' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ status: 'completed', content: 'report' }); });
  assert.match((await createSystemToolCatalog().tavily_research.invoke({ query: 'population' })).error, /上限/);
  assert.equal(calls, 0);
  process.env.TAVILY_RESEARCH_MAX_CALLS = '1';
  const tools = createSystemToolCatalog();
  await tools.tavily_research.invoke({ query: 'population' });
  await tools.tavily_research.invoke({ query: 'population' });
  assert.match((await tools.tavily_research.invoke({ query: 'housing' })).error, /上限/);
  assert.equal(calls, 1);
});
