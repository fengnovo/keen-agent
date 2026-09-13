'use client';

import React from 'react';

import {
  extractReasoningTraceMarkers,
  isAskUserInteractive,
  isReasoningStreamDone,
  parseReasoningTrace,
  reconcileReasoningTrace,
  type ReasoningAskUserStep,
  type TodoItem,
} from '../_utils/reasoning-trace';
import { AskUserModal } from './AskUserModal';
import { MarkdownContent } from './MarkdownContent';
import { ThinkComponent } from './ThinkComponent';
import { TodoList } from './TodoList';

interface AssistantMessageContentProps {
  content: string;
  className: string;
  status?: string;
  /** 用户取消 ask_user 弹窗时中止当前流，避免服务端一直等待。 */
  onAskUserCancel?: () => void;
}

interface AssistantContentParts {
  reasoning?: string;
  answer: string;
  reasoningDone: boolean;
}

const THINK_OPEN_PATTERN = /<think\b[^>]*>/i;
const THINK_CLOSE_TAG = '</think>';

const splitAssistantContent = (
  content: string,
  status?: string,
): AssistantContentParts => {
  const reasoningDone = isReasoningStreamDone(status);
  const openTag = THINK_OPEN_PATTERN.exec(content);
  if (!openTag || openTag.index === undefined) {
    const inlineTrace = extractReasoningTraceMarkers(content);
    if (inlineTrace.hasTrace) {
      return {
        reasoning: inlineTrace.reasoning ?? '',
        answer: inlineTrace.answer,
        reasoningDone,
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

  return {
    reasoning: reconciled.reasoning,
    answer: reconciled.answer,
    reasoningDone,
  };
};

/** 将思考时间线和正式回答拆成两个视觉区域，避免共享同一个 Markdown 灰色块。 */
export const AssistantMessageContent: React.FC<
  AssistantMessageContentProps
> = ({ content, className, status, onAskUserCancel }) => {
  const parts = React.useMemo(
    () => splitAssistantContent(content, status),
    [content, status],
  );

  const { todos, askUser } = React.useMemo(() => {
    if (parts.reasoning === undefined) return { todos: undefined, askUser: undefined };
    const trace = parseReasoningTrace(parts.reasoning);
    const latestTodo = [...trace.steps]
      .reverse()
      .find((step): step is { kind: 'todo'; key: string; todos: TodoItem[] } => step.kind === 'todo');
    const latestAsk = [...trace.steps]
      .reverse()
      .find((step): step is ReasoningAskUserStep => step.kind === 'ask_user');
    return {
      todos: latestTodo?.todos,
      askUser: latestAsk,
    };
  }, [parts.reasoning]);

  // 历史回放（status=success）里的 ask_user 已失效，仅在实时流中允许交互。
  const interactiveAskUser = isAskUserInteractive(status) ? askUser : undefined;

  return (
    <div className='assistant-message-content'>
      {todos && todos.length > 0 ? <TodoList todos={todos} /> : null}

      {parts.reasoning !== undefined ? (
        <ThinkComponent
          content={parts.reasoning}
          className={className}
          isDone={parts.reasoningDone}
          status={status}
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

      {interactiveAskUser ? (
        <AskUserModal
          key={interactiveAskUser.runId}
          runId={interactiveAskUser.runId}
          request={interactiveAskUser.request}
          onCancel={onAskUserCancel}
        />
      ) : null}
    </div>
  );
};
