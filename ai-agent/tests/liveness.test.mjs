import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  DEFAULT_LIVENESS_TIMEOUTS,
  createLivenessWatchdog,
  resolveLivenessTimeouts,
} from '../src/core/liveness.ts';

test('工具执行阶段的静默不会被空闲阈值误杀（历史 bug 回归）', async () => {
  const watchdog = createLivenessWatchdog({
    timeouts: { idleMs: 40, toolRunningMs: 600, modelGeneratingMs: 600 },
  });
  watchdog.callback.handleToolStart();

  // 旧实现把工具执行当成 idle，40ms 后就会 abort 整轮对话。
  await sleep(200);
  assert.equal(watchdog.phase(), 'tool-running');
  assert.equal(watchdog.timedOut(), false);
  assert.equal(watchdog.signal.aborted, false);

  // 工具真的永远不返回时，仍按工具阶段的窗口兜底中止。
  await sleep(600);
  assert.equal(watchdog.timedOut(), true);
  assert.equal(watchdog.signal.aborted, true);
  watchdog.dispose();
});

test('等待用户弹窗回答期间停表，恢复后重新计时', async () => {
  const watchdog = createLivenessWatchdog({
    timeouts: { idleMs: 50, toolRunningMs: 50, modelGeneratingMs: 50 },
  });

  watchdog.pause();
  await sleep(250);
  assert.equal(watchdog.signal.aborted, false);

  watchdog.resume();
  await sleep(250);
  assert.equal(watchdog.timedOut(), true);
  watchdog.dispose();
});

test('stream event 续期当前阶段', async () => {
  const watchdog = createLivenessWatchdog({
    timeouts: { idleMs: 80, toolRunningMs: 80, modelGeneratingMs: 80 },
  });

  for (const _ of [1, 2, 3]) {
    await sleep(40);
    watchdog.reset();
  }
  assert.equal(watchdog.timedOut(), false);

  await sleep(200);
  assert.equal(watchdog.timedOut(), true);
  watchdog.dispose();
});

test('callback 把模型与工具生命周期映射到对应阶段', () => {
  const watchdog = createLivenessWatchdog();
  assert.equal(watchdog.phase(), 'idle');

  watchdog.callback.handleLLMStart();
  assert.equal(watchdog.phase(), 'model-generating');

  watchdog.callback.handleToolStart();
  assert.equal(watchdog.phase(), 'tool-running');

  watchdog.callback.handleToolEnd();
  assert.equal(watchdog.phase(), 'idle');

  watchdog.callback.handleChatModelStreamEvent();
  assert.equal(watchdog.phase(), 'model-generating');
  watchdog.dispose();
});

test('dispose 后不再触发超时', async () => {
  const watchdog = createLivenessWatchdog({
    timeouts: { idleMs: 40, toolRunningMs: 40, modelGeneratingMs: 40 },
  });
  watchdog.dispose();
  await sleep(150);
  assert.equal(watchdog.timedOut(), false);
});

test('工具阶段窗口必须大于沙箱命令上限，否则长命令仍在正常运行时就会误杀', () => {
  // ai-agent/src/sandbox/docker-sandbox.ts 把单次命令上限限制在 600s。
  assert.ok(DEFAULT_LIVENESS_TIMEOUTS.toolRunningMs > 600_000);
  assert.ok(
    DEFAULT_LIVENESS_TIMEOUTS.modelGeneratingMs >
      DEFAULT_LIVENESS_TIMEOUTS.idleMs,
  );
});

test('环境变量可覆盖阈值，非法值回落默认', () => {
  assert.deepEqual(
    resolveLivenessTimeouts({
      AI_AGENT_MODEL_TIMEOUT_MS: '600000',
      AI_AGENT_TOOL_TIMEOUT_MS: '1200000',
      AI_AGENT_IDLE_TIMEOUT_MS: '300000',
    }),
    { modelGeneratingMs: 600_000, toolRunningMs: 1_200_000, idleMs: 300_000 },
  );

  assert.deepEqual(resolveLivenessTimeouts({}), {
    modelGeneratingMs: DEFAULT_LIVENESS_TIMEOUTS.modelGeneratingMs,
    toolRunningMs: DEFAULT_LIVENESS_TIMEOUTS.toolRunningMs,
    idleMs: DEFAULT_LIVENESS_TIMEOUTS.idleMs,
  });

  // 小于下限 / 非数字：回落默认值，避免"0 秒超时"这类致命配置。
  assert.deepEqual(
    resolveLivenessTimeouts({
      AI_AGENT_MODEL_TIMEOUT_MS: '1',
      AI_AGENT_TOOL_TIMEOUT_MS: 'abc',
      AI_AGENT_IDLE_TIMEOUT_MS: '-5',
    }),
    {
      modelGeneratingMs: DEFAULT_LIVENESS_TIMEOUTS.modelGeneratingMs,
      toolRunningMs: DEFAULT_LIVENESS_TIMEOUTS.toolRunningMs,
      idleMs: DEFAULT_LIVENESS_TIMEOUTS.idleMs,
    },
  );
});
