import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import {
  MCP_TOOL_ERROR_PREFIX,
  makeMcpToolRecoverable,
} from '../src/plugins/mcp-loader.ts';

const plugin = { id: 'test-mcp', name: '测试搜索' };

const createFailingTool = (message = 'TypeError: terminated') =>
  new DynamicStructuredTool({
    name: 'test_search',
    description: '测试工具',
    schema: z.object({ query: z.string() }),
    responseFormat: 'content_and_artifact',
    func: async () => {
      throw new Error(message);
    },
  });

test('converts an MCP transport failure to a content-and-artifact result', async () => {
  const tool = makeMcpToolRecoverable(plugin, createFailingTool());
  const result = await tool.func({ query: '广州天气' });

  assert.equal(Array.isArray(result), true);
  assert.equal(result[0].startsWith(MCP_TOOL_ERROR_PREFIX), true);
  assert.match(result[0], /远端服务连接意外中断/);
  assert.deepEqual(result[1], []);
});

test('recovers a per-tool timeout whose derived signal is already aborted', async () => {
  const tool = makeMcpToolRecoverable(
    plugin,
    createFailingTool('TimeoutError: The operation was aborted due to timeout'),
  );
  const controller = new AbortController();
  controller.abort(new DOMException('Timed out', 'TimeoutError'));

  const result = await tool.func({ query: '广州天气' }, undefined, {
    signal: controller.signal,
  });

  assert.equal(Array.isArray(result), true);
  assert.match(
    result[0],
    /远端服务响应超时/,
  );
});
