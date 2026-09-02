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
  status: 'running' | 'success' | 'error';
  inputSummary?: string;
  outputSummary?: string;
}

export type ReasoningTraceStep = ReasoningTextStep | ReasoningToolStep;

export interface ParsedReasoningTrace {
  steps: ReasoningTraceStep[];
  durationMs?: number;
}

const TRACE_MARKER_PATTERN =
  /\[keen-tool-event:([^\]\r\n]+)\]|\[keen-reasoning-duration:(\d+)\]/g;

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
