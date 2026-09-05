import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WEB_GENERATION_SYSTEM_PROMPT,
  createWebGenerationWriteFirstMiddleware,
  isWebGenerationRequest,
} from '../src/core/agent.ts';

test('recognizes explicit Chinese and English web generation requests', () => {
  assert.equal(
    isWebGenerationRequest('写一个关于介绍 LangChain 的类似官网的页面'),
    true,
  );
  assert.equal(isWebGenerationRequest('Build a React landing page'), true);
  assert.equal(isWebGenerationRequest('介绍一下 LangChain'), false);
});

test('web generation contract forbids full source in reasoning', () => {
  assert.match(WEB_GENERATION_SYSTEM_PROMPT, /第一次工作工具调用必须是 write_file/);
  assert.match(WEB_GENERATION_SYSTEM_PROMPT, /可以先调用 plan_tasks/);
  assert.match(WEB_GENERATION_SYSTEM_PROMPT, /思考内容和最终回答都禁止输出完整源码/);
});

test('forces Anthropic to call write_file only on the first model turn', async () => {
  const middleware = createWebGenerationWriteFirstMiddleware('anthropic');
  const requests = [];
  const request = {
    tools: [{ name: 'write_file' }, { name: 'execute' }],
    toolChoice: 'auto',
  };
  const handler = async (nextRequest) => {
    requests.push(nextRequest);
    return { content: '' };
  };

  await middleware.wrapModelCall(request, handler);
  await middleware.wrapModelCall(request, handler);

  assert.equal(requests[0].toolChoice, 'write_file');
  assert.deepEqual(requests[0].tools, [{ name: 'write_file' }]);
  assert.equal(requests[1].toolChoice, 'auto');
  assert.deepEqual(requests[1].tools, request.tools);
});

test('uses the OpenAI named-function tool choice format', async () => {
  const middleware = createWebGenerationWriteFirstMiddleware('openai');
  let capturedRequest;

  await middleware.wrapModelCall(
    { tools: [{ name: 'write_file' }] },
    async (request) => {
      capturedRequest = request;
      return { content: '' };
    },
  );

  assert.deepEqual(capturedRequest.toolChoice, {
    type: 'function',
    function: { name: 'write_file' },
  });
});

test('keeps Kimi K3 tool choice automatic while exposing only write_file', async () => {
  const middleware = createWebGenerationWriteFirstMiddleware(
    'anthropic',
    'kimi-k3',
  );
  let capturedRequest;

  await middleware.wrapModelCall(
    {
      tools: [{ name: 'write_file' }, { name: 'execute' }],
      toolChoice: 'write_file',
    },
    async (request) => {
      capturedRequest = request;
      return { content: '' };
    },
  );

  assert.equal(capturedRequest.toolChoice, 'auto');
  assert.deepEqual(capturedRequest.tools, [{ name: 'write_file' }]);
});
