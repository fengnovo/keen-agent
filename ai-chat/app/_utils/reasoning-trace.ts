export interface ReasoningTextStep {
  kind: 'reasoning';
  key: string;
  content: string;
}

export interface ReasoningToolStep {
  kind: 'tool';
  key: string;
  callId: string;
  name: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  inputSummary?: string;
  outputSummary?: string;
}

export type ReasoningTraceStep = ReasoningTextStep | ReasoningToolStep;

export interface ParsedReasoningTrace {
  steps: ReasoningTraceStep[];
  durationMs?: number;
}

export interface ExtractedReasoningTraceMarkers {
  answer: string;
  reasoning?: string;
  hasTrace: boolean;
}

export interface ReconciledReasoningTrace {
  reasoning: string;
  answer: string;
  hasInlineTrace: boolean;
}

/** 思考面板必须等整条助手消息停止流式更新后，才能进入最终完成态。 */
export const isReasoningStreamDone = (status?: string): boolean =>
  status !== 'loading' && status !== 'updating';

/** A disconnected/aborted stream cannot leave tools visually running forever. */
export const settleReasoningSteps = (steps: ReasoningTraceStep[], isDone: boolean): ReasoningTraceStep[] =>
  steps.map(step => isDone && step.kind === 'tool' && step.status === 'running'
    ? { ...step, status: 'stopped' } : step);

const TRACE_MARKER_PATTERN =
  /\[keen-tool-event:([^\]\r\n]+)\]|\[keen-reasoning-duration:(\d+)\]/g;
const TRACE_MARKER_PREFIXES = [
  '[keen-tool-event:',
  '[keen-reasoning-duration:',
] as const;

/** 流片段可能停在内部标记中间；在闭合方括号到达前不把半截协议显示给用户。 */
const findPendingTraceMarker = (content: string): number => {
  let pendingIndex = -1;

  for (const prefix of TRACE_MARKER_PREFIXES) {
    const index = content.lastIndexOf(prefix);
    if (index > pendingIndex && content.indexOf(']', index) < 0) {
      pendingIndex = index;
    }
  }

  return pendingIndex;
};

/**
 * 当实时 Provider 没有建立 `<think>` 区域时，从正文中抽离服务端的带外轨迹标记。
 * 历史消息本来就会把 reasoningContent 包进 `<think>`，这个兼容层只处理实时乱序流。
 */
export const extractReasoningTraceMarkers = (
  content: string,
): ExtractedReasoningTraceMarkers => {
  const answerParts: string[] = [];
  const reasoningMarkers: string[] = [];
  let cursor = 0;

  for (const match of content.matchAll(TRACE_MARKER_PATTERN)) {
    const matchIndex = match.index ?? 0;
    answerParts.push(content.slice(cursor, matchIndex));
    reasoningMarkers.push(match[0]);
    cursor = matchIndex + match[0].length;
  }

  const tail = content.slice(cursor);
  const pendingIndex = findPendingTraceMarker(tail);
  answerParts.push(
    pendingIndex >= 0 ? tail.slice(0, pendingIndex).trimEnd() : tail,
  );

  return {
    answer: answerParts.join('').trim(),
    reasoning:
      reasoningMarkers.length > 0
        ? reasoningMarkers.join('\n\n')
        : undefined,
    hasTrace: reasoningMarkers.length > 0 || pendingIndex >= 0,
  };
};

/**
 * DeepSeek Provider 可能先闭合 `<think>`，再把后到的工具事件追加进正文。
 * 将这部分带外标记重新并入已有思考内容，确保实时流和刷新后的历史展示一致。
 */
export const reconcileReasoningTrace = (
  reasoning: string,
  answer: string,
): ReconciledReasoningTrace => {
  const inlineTrace = extractReasoningTraceMarkers(answer);
  if (!inlineTrace.hasTrace) {
    return { reasoning, answer, hasInlineTrace: false };
  }

  return {
    reasoning: [reasoning.trim(), inlineTrace.reasoning]
      .filter((value): value is string => Boolean(value))
      .join('\n\n'),
    answer: inlineTrace.answer,
    hasInlineTrace: true,
  };
};

const parseToolStep = (payload: string): ReasoningToolStep | undefined => {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(payload));
    if (!parsed || typeof parsed !== 'object') return undefined;

    const event = parsed as Record<string, unknown>;
    if (event.type !== 'tool') return undefined;
    if (typeof event.callId !== 'string' || !event.callId) return undefined;
    if (typeof event.name !== 'string' || !event.name) return undefined;
    if (!['running', 'success', 'error'].includes(String(event.status))) {
      return undefined;
    }

    return {
      kind: 'tool',
      key: `tool:${event.callId}`,
      callId: event.callId,
      name: event.name,
      status: event.status as ReasoningToolStep['status'],
      inputSummary:
        typeof event.inputSummary === 'string'
          ? event.inputSummary
          : undefined,
      outputSummary:
        typeof event.outputSummary === 'string'
          ? event.outputSummary
          : undefined,
    };
  } catch {
    return undefined;
  }
};

/** 把服务端插入的工具生命周期标记还原成按发生顺序排列的思考步骤。 */
export const parseReasoningTrace = (content: string): ParsedReasoningTrace => {
  const steps: ReasoningTraceStep[] = [];
  const toolIndexes = new Map<string, number>();
  let durationMs: number | undefined;
  let cursor = 0;
  let reasoningSequence = 0;

  const appendReasoning = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    reasoningSequence += 1;
    steps.push({
      kind: 'reasoning',
      key: `reasoning:${reasoningSequence}`,
      content: normalized,
    });
  };

  for (const match of content.matchAll(TRACE_MARKER_PATTERN)) {
    appendReasoning(content.slice(cursor, match.index));

    if (match[1]) {
      const toolStep = parseToolStep(match[1]);
      if (toolStep) {
        const existingIndex = toolIndexes.get(toolStep.callId);
        if (existingIndex === undefined) {
          toolIndexes.set(toolStep.callId, steps.length);
          steps.push(toolStep);
        } else {
          const existing = steps[existingIndex];
          if (existing?.kind === 'tool') {
            steps[existingIndex] = {
              ...existing,
              ...toolStep,
              inputSummary:
                toolStep.inputSummary ?? existing.inputSummary,
              outputSummary:
                toolStep.outputSummary ?? existing.outputSummary,
            };
          }
        }
      }
    } else if (match[2]) {
      const parsedDuration = Number(match[2]);
      if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
        durationMs = parsedDuration;
      }
    }

    cursor = (match.index ?? 0) + match[0].length;
  }

  appendReasoning(content.slice(cursor));
  return { steps, durationMs };
};

export const formatReasoningDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
};
