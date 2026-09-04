import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createAgentRuntime } from '../src/core/agent.ts';
import { verifyOrchestrationEvents } from '../src/core/orchestration.ts';
import {
  createDefaultPluginRegistry,
} from '../src/config/plugin-config.ts';
import {
  findModel,
  getActiveModel,
  loadModelRegistry,
} from '../src/config/model-config.ts';

dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

const BENCHMARK_PROMPT = [
  '请为已有 Node.js 单体服务迁移到多租户 SaaS 写一份架构选择备忘录，',
  '分别比较数据迁移、租户鉴权与隔离、灰度发布以及可观测性四个方向，',
  '每个方向最多两条关键取舍，最后汇总共同约束；总报告不超过 600 字。',
].join('');

const loadedModels = await loadModelRegistry();
const requestedModelId = process.env.MULTI_AGENT_VERIFY_MODEL_ID?.trim();
const model = requestedModelId
  ? findModel(loadedModels.registry, requestedModelId)
  : getActiveModel(loadedModels.registry);

if (!model) {
  throw new Error(`找不到验收模型：${requestedModelId}`);
}

// 验收只测试 DeepAgent 自身，不连接 MCP、不启动 Docker，也不让示例工具干扰决策。
const pluginRegistry = createDefaultPluginRegistry();
pluginRegistry.plugins = pluginRegistry.plugins.map((plugin) => ({
  ...plugin,
  enabled: plugin.id === 'deepagent-core',
}));

const configuredConcurrency = Number(process.env.AI_SUBAGENT_CONCURRENCY);
const subagentConcurrency =
  Number.isInteger(configuredConcurrency) && configuredConcurrency >= 1
    ? Math.min(configuredConcurrency, 16)
    : 2;
const configuredRetries = Number(process.env.AI_SUBAGENT_MAX_RETRIES);
const subagentMaxRetries =
  Number.isInteger(configuredRetries) && configuredRetries >= 0
    ? Math.min(configuredRetries, 8)
    : 2;

const runtime = await createAgentRuntime(model, {
  pluginRegistry,
  thinkingEnabled: true,
  toolsEnabled: true,
  subagentConcurrency,
  subagentMaxRetries,
});
const toolEvents = [];
const activeTaskRoles = new Map();
const anonymousTaskRoles = [];
const timeoutMs = Number(process.env.MULTI_AGENT_VERIFY_TIMEOUT_MS) || 600_000;
let runError;

console.log(`验收模型：${model.name} (${model.id})`);
console.log(
  '具名子 Agent：general-purpose / planner / researcher / implementer / reviewer',
);
console.log(
  `子 Agent 实际执行并发上限：${subagentConcurrency}；临时错误重试：${subagentMaxRetries} 次`,
);
console.log('正在运行不显式要求使用子 Agent 的复杂任务…');

try {
  try {
    const stream = await runtime.agent.stream(
      { messages: [{ role: 'user', content: BENCHMARK_PROMPT }] },
      {
        configurable: { thread_id: randomUUID() },
        streamMode: ['messages', 'tools'],
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    for await (const item of stream) {
      if (!Array.isArray(item) || item[0] !== 'tools') continue;
      const payload = item[1];
      if (!payload || typeof payload !== 'object') continue;
      if (
        !['on_tool_start', 'on_tool_end', 'on_tool_error'].includes(
          payload.event,
        ) ||
        typeof payload.name !== 'string'
      ) {
        continue;
      }

      const event = {
        event: payload.event,
        name: payload.name,
        toolCallId:
          typeof payload.toolCallId === 'string'
            ? payload.toolCallId
            : undefined,
        input: payload.input,
        output: payload.output,
      };
      toolEvents.push(event);

      if (event.name === 'write_todos' && event.event === 'on_tool_start') {
        console.log('  ✓ 主 Agent 建立计划');
      } else if (event.name === 'task') {
        let input = event.input;
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input);
          } catch {
            input = undefined;
          }
        }
        let role =
          input && typeof input === 'object' &&
          typeof input.subagent_type === 'string'
            ? input.subagent_type
            : undefined;
        if (event.event === 'on_tool_start') {
          if (event.toolCallId) activeTaskRoles.set(event.toolCallId, role);
          else anonymousTaskRoles.push(role);
        } else {
          role = event.toolCallId
            ? activeTaskRoles.get(event.toolCallId)
            : anonymousTaskRoles.shift();
          if (event.toolCallId) activeTaskRoles.delete(event.toolCallId);
        }
        console.log(`  ${event.event}: task(${role ?? 'unknown'})`);
      }
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
  }

  const report = verifyOrchestrationEvents(toolEvents);
  if (runError) report.errors.push(`运行未正常收敛：${runError}`);
  report.passed = report.passed && !runError;
  console.log('\n验收报告：');
  console.log(JSON.stringify(report, null, 2));

  if (!report.passed) process.exitCode = 1;
} finally {
  await runtime.close().catch(() => undefined);
}
