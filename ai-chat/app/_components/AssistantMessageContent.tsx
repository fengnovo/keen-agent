'use client';

import React from 'react';

import {
  extractReasoningTraceMarkers,
  reconcileReasoningTrace,
} from '../_utils/reasoning-trace';
import { MarkdownContent } from './MarkdownContent';
import { ThinkComponent } from './ThinkComponent';

interface AssistantMessageContentProps {
  content: string;
  className: string;
  status?: string;
}

interface AssistantContentParts {
  reasoning?: string;
  answer: string;
  reasoningDone: boolean;
}

const THINK_OPEN_PATTERN = /<think\b([^>]*)>/i;
const THINK_DONE_STATUS_PATTERN = /\bstatus\s*=\s*["']done["']/i;
const THINK_CLOSE_TAG = '</think>';

const splitAssistantContent = (
  content: string,
  status?: string,
): AssistantContentParts => {
  const openTag = THINK_OPEN_PATTERN.exec(content);
  if (!openTag || openTag.index === undefined) {
    const inlineTrace = extractReasoningTraceMarkers(content);
    if (inlineTrace.hasTrace) {
      return {
        reasoning: inlineTrace.reasoning ?? '',
        answer: inlineTrace.answer,
        reasoningDone: !['loading', 'updating'].includes(status ?? ''),
      };
    }

    return { answer: content, reasoningDone: true };
  }

  const reasoningStart = openTag.index + openTag[0].length;
  const closingIndex = content.indexOf(THINK_CLOSE_TAG, reasoningStart);
  const hasClosingTag = closingIndex >= 0;
  const initialReasoning = content.slice(
    reasoningStart,
    hasClosingTag ? closingIndex : content.length,
  );
  const leadingContent = content.slice(0, openTag.index).trim();
  const trailingContent = hasClosingTag
    ? content.slice(closingIndex + THINK_CLOSE_TAG.length).trimStart()
    : '';
  const initialAnswer = [leadingContent, trailingContent]
    .filter(Boolean)
    .join('\n\n');
  const reconciled = reconcileReasoningTrace(initialReasoning, initialAnswer);
  const reasoningDone =
    hasClosingTag ||
    THINK_DONE_STATUS_PATTERN.test(openTag[1] ?? '') ||
    !['loading', 'updating'].includes(status ?? '');

  return {
    reasoning: reconciled.reasoning,
    answer: reconciled.answer,
    reasoningDone,
  };
};

/** 将思考时间线和正式回答拆成两个视觉区域，避免共享同一个 Markdown 灰色块。 */
export const AssistantMessageContent: React.FC<
  AssistantMessageContentProps
> = ({ content, className, status }) => {
  const parts = React.useMemo(
    () => splitAssistantContent(content, status),
    [content, status],
  );

  return (
    <div className='assistant-message-content'>
      {parts.reasoning !== undefined ? (
        <ThinkComponent
          content={parts.reasoning}
          className={className}
          isDone={parts.reasoningDone}
        />
      ) : null}

      {parts.answer ? (
        <div className='assistant-answer'>
          <MarkdownContent
            content={parts.answer}
            className={className}
            isStreaming={status === 'updating'}
            variant='answer'
          />
        </div>
      ) : null}
    </div>
  );
};
