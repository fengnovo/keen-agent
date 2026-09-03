import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractReasoningTraceMarkers,
  isReasoningStreamDone,
  parseReasoningTrace,
  reconcileReasoningTrace,
} from '../app/_utils/reasoning-trace.ts';

const toolMarker = (event) =>
  `[keen-tool-event:${encodeURIComponent(JSON.stringify(event))}]`;

test('extracts tool markers that arrive after answer text', () => {
  const marker = toolMarker({
    type: 'tool',
    callId: 'search-1',
    name: 'bing__search',
    status: 'success',
    outputSummary: '返回 2 个链接',
  });
  const result = extractReasoningTraceMarkers(
    `我来搜索一下。\n\n${marker}\n\n这是整理后的回答。`,
  );

  assert.equal(result.hasTrace, true);
  assert.equal(result.answer.includes('%7B'), false);
  assert.match(result.answer, /我来搜索一下。[\s\S]*这是整理后的回答。/);

  const trace = parseReasoningTrace(result.reasoning ?? '');
  assert.deepEqual(trace.steps, [
    {
      kind: 'tool',
      key: 'tool:search-1',
      callId: 'search-1',
      name: 'bing__search',
      status: 'success',
      inputSummary: undefined,
      outputSummary: '返回 2 个链接',
    },
  ]);
});

test('hides an incomplete streaming marker until its closing bracket arrives', () => {
  const result = extractReasoningTraceMarkers(
    '正在搜索…\n\n[keen-tool-event:%7B%22type%22%3A%22tool%22',
  );

  assert.equal(result.hasTrace, true);
  assert.equal(result.reasoning, undefined);
  assert.equal(result.answer, '正在搜索…');
});

test('moves tool markers appended after a closed think block back into reasoning', () => {
  const marker = toolMarker({
    type: 'tool',
    callId: 'weather-1',
    name: 'bing__search',
    status: 'running',
    inputSummary: '深圳天气',
  });
  const result = reconcileReasoningTrace(
    '需要先查询天气。',
    `我来帮你查询。\n\n${marker}`,
  );

  assert.equal(result.hasInlineTrace, true);
  assert.equal(result.answer, '我来帮你查询。');
  assert.equal(result.answer.includes('[keen-tool-event:'), false);

  const trace = parseReasoningTrace(result.reasoning);
  assert.deepEqual(trace.steps, [
    {
      kind: 'reasoning',
      key: 'reasoning:1',
      content: '需要先查询天气。',
    },
    {
      kind: 'tool',
      key: 'tool:weather-1',
      callId: 'weather-1',
      name: 'bing__search',
      status: 'running',
      inputSummary: '深圳天气',
      outputSummary: undefined,
    },
  ]);
});

test('leaves ordinary assistant content unchanged', () => {
  const result = extractReasoningTraceMarkers('普通回答');

  assert.deepEqual(result, {
    answer: '普通回答',
    reasoning: undefined,
    hasTrace: false,
  });
});

test('keeps reasoning in loading state until the whole response settles', () => {
  assert.equal(isReasoningStreamDone('loading'), false);
  assert.equal(isReasoningStreamDone('updating'), false);
  assert.equal(isReasoningStreamDone('success'), true);
  assert.equal(isReasoningStreamDone('error'), true);
  assert.equal(isReasoningStreamDone('abort'), true);
});
