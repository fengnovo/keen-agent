/**
 * Agent 运行活跃度看门狗：Chat 服务端与 CLI 共用同一套阶段判定。
 *
 * 为什么必须分阶段：不同阶段的"静默"含义完全不同，用单一阈值判定卡死必然误杀。
 * - `model-generating`：模型正在生成（含 thinking 与 tool-call 参数）。部分供应商
 *   不流式输出 tool-call 参数，此时 stream 没有 event，只有 LangChain callback
 *   能证明模型仍在工作；窗口要宽裕，避免掐断大文件生成。
 * - `tool-running`：工具正在执行（长命令、Docker 构建、MCP 调用、子 Agent）。
 *   工具自身已有超时（沙箱命令默认 180s、上限 600s，MCP 工具默认 30s），外层看门狗
 *   只负责兜底"工具永远不返回"，因此必须比所有工具自身超时更宽裕，否则会在工具
 *   正常运行时把整轮对话判死。
 * - `idle`：图在两个步骤之间推进（工具结束到下一轮模型调用等）。这里的静默才是
 *   真正的可疑信号，使用短超时。
 *
 * 另外，等待用户回答弹窗（ask_user）期间的静默完全由人决定，必须暂停看门狗。
 */

import { type CallbackHandlerMethods } from '@langchain/core/callbacks/base';

export type LivenessPhase = 'model-generating' | 'tool-running' | 'idle';

export type LivenessPulse = (phase: LivenessPhase) => void;

export interface LivenessTimeouts {
  /** 模型生成阶段的静默上限。 */
  modelGeneratingMs: number;
  /** 工具执行阶段的静默上限，必须大于所有工具自身的超时。 */
  toolRunningMs: number;
  /** 步骤之间空闲的静默上限。 */
  idleMs: number;
}

const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60 * 60_000;

export const DEFAULT_LIVENESS_TIMEOUTS: LivenessTimeouts = {
  modelGeneratingMs: 15 * 60_000,
  // 10 分钟的沙箱命令上限 + 子 Agent / MCP 往返余量。
  toolRunningMs: 30 * 60_000,
  idleMs: 3 * 60_000,
};

const resolveTimeout = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) &&
    value >= MIN_TIMEOUT_MS &&
    value <= MAX_TIMEOUT_MS
    ? value
    : fallback;
};

/** 超时阈值全部可通过环境变量覆盖；非法值静默回落到默认值。 */
export const resolveLivenessTimeouts = (
  env: NodeJS.ProcessEnv = process.env,
): LivenessTimeouts => ({
  modelGeneratingMs: resolveTimeout(
    env.AI_AGENT_MODEL_TIMEOUT_MS,
    DEFAULT_LIVENESS_TIMEOUTS.modelGeneratingMs,
  ),
  toolRunningMs: resolveTimeout(
    env.AI_AGENT_TOOL_TIMEOUT_MS,
    DEFAULT_LIVENESS_TIMEOUTS.toolRunningMs,
  ),
  idleMs: resolveTimeout(
    env.AI_AGENT_IDLE_TIMEOUT_MS,
    DEFAULT_LIVENESS_TIMEOUTS.idleMs,
  ),
});

export const livenessTimeoutMs = (
  phase: LivenessPhase,
  timeouts: LivenessTimeouts,
): number => {
  if (phase === 'model-generating') return timeouts.modelGeneratingMs;
  if (phase === 'tool-running') return timeouts.toolRunningMs;
  return timeouts.idleMs;
};

/**
 * 创建 LangChain callback，在模型 token / 工具生命周期级别上报活跃信号。
 * 用于在 stream event 稀疏时仍能区分"模型正在生成"、"工具正在执行"与"真正卡死"。
 */
export const createLivenessCallback = (
  pulse: LivenessPulse,
): CallbackHandlerMethods => ({
  handleLLMStart: () => pulse('model-generating'),
  handleChatModelStart: () => pulse('model-generating'),
  handleLLMNewToken: () => pulse('model-generating'),
  handleChatModelStreamEvent: () => pulse('model-generating'),
  handleLLMEnd: () => pulse('idle'),
  handleToolStart: () => pulse('tool-running'),
  handleToolEnd: () => pulse('idle'),
});

export interface LivenessWatchdog {
  /** 超时时中止的合并信号（与客户端断开信号再合并使用）。 */
  readonly signal: AbortSignal;
  /** 传给 agent.stream 的 LangChain 回调。 */
  readonly callback: CallbackHandlerMethods;
  /** 当前阶段，用于生成对用户有意义的超时提示。 */
  phase: () => LivenessPhase;
  /** 看门狗是否已经触发中止。 */
  timedOut: () => boolean;
  /** 手动进入并重新计时（stream 之外的长时间工作，如 OCR 预处理）。 */
  enter: (phase: LivenessPhase) => void;
  /** stream event 到达时按当前阶段续期。 */
  reset: () => void;
  /** 暂停计时：等待用户输入等由人决定的静默期间不得判定卡死。 */
  pause: () => void;
  /** 恢复计时，可顺带切换到指定阶段。 */
  resume: (phase?: LivenessPhase) => void;
  /** 指定阶段（默认当前阶段）的超时阈值。 */
  timeoutMs: (phase?: LivenessPhase) => number;
  /** 释放计时器。 */
  dispose: () => void;
}

export interface LivenessWatchdogOptions {
  /** 覆盖默认/环境变量阈值，测试可传入毫秒级窗口。 */
  timeouts?: Partial<LivenessTimeouts>;
}

export const createLivenessWatchdog = (
  options: LivenessWatchdogOptions = {},
): LivenessWatchdog => {
  const timeouts: LivenessTimeouts = {
    ...resolveLivenessTimeouts(),
    ...options.timeouts,
  };
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let phase: LivenessPhase = 'idle';
  let paused = false;
  let fired = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const arm = (next: LivenessPhase) => {
    phase = next;
    clear();
    // 暂停期间只记录阶段，不参与判定。
    if (paused || controller.signal.aborted) return;

    timer = setTimeout(() => {
      fired = true;
      controller.abort();
    }, livenessTimeoutMs(next, timeouts));
  };

  // 初始视为 idle：模型还没开始生成。
  arm('idle');

  return {
    signal: controller.signal,
    callback: createLivenessCallback((next) => arm(next)),
    phase: () => phase,
    timedOut: () => fired,
    enter: (next) => arm(next),
    reset: () => arm(phase),
    pause: () => {
      paused = true;
      clear();
    },
    resume: (next = phase) => {
      paused = false;
      arm(next);
    },
    timeoutMs: (target = phase) => livenessTimeoutMs(target, timeouts),
    dispose: clear,
  };
};
