/**
 * 思维链组件
 * 使用单个思维链节点承载模型返回的连续推理内容
 */

import React from 'react';
import { ThoughtChain } from '@ant-design/x';
import type { ThoughtChainItemType } from '@ant-design/x';
import type { ComponentProps } from '@ant-design/x-markdown';
import { texts } from '../_utils/local';

/**
 * 过滤 Markdown 解析产生的空白文本节点。
 */
const hasContent = (node: React.ReactNode) =>
  typeof node !== 'string' || node.trim().length > 0;

/**
 * 思维链组件
 * 推理接口只返回一段连续 reasoning_content，并没有结构化步骤或工具事件，
 * 因此保留为一个真实节点，避免按 Markdown 排版块伪造步骤。
 */
export const ThinkComponent: React.FC<ComponentProps> = React.memo(
  function ThinkComponent(props) {
    const isDone = props.streamStatus === 'done';
    const hasReasoningContent = React.Children.toArray(props.children).some(
      hasContent,
    );
    const reasoningKey = 'model-reasoning';
    const items: ThoughtChainItemType[] = [
      {
        key: reasoningKey,
        title: isDone ? texts.completeThinking : `${texts.deepThinking}...`,
        content: hasReasoningContent ? props.children : undefined,
        status: isDone ? 'success' : 'loading',
        blink: !isDone,
        collapsible: isDone && hasReasoningContent,
      },
    ];

    return (
      <ThoughtChain
        key={isDone ? 'thought-chain-done' : 'thought-chain-streaming'}
        className='markdown-thought-chain'
        items={items}
        defaultExpandedKeys={isDone ? [reasoningKey] : undefined}
        aria-label={isDone ? texts.completeThinking : texts.deepThinking}
      />
    );
  },
);
