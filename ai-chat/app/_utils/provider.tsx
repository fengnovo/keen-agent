/**
 * Provider 和 Role 配置
 * 包含聊天 Provider 工厂函数和消息角色配置
 */

import React from 'react';
import type { BubbleListProps } from '@ant-design/x';
import type { DefaultMessageInfo } from '@ant-design/x-sdk';
import {
  DeepSeekChatProvider,
  SSEFields,
  XRequest,
} from '@ant-design/x-sdk';
import type {
  XModelMessage,
  XModelParams,
  XModelResponse,
  XRequestOptions,
} from '@ant-design/x-sdk';
import { ChatMessage } from './types';
import { getConversation } from './conversation-api';
import { AssistantMessageContent } from '../_components/AssistantMessageContent';

/**
 * Provider 缓存
 * 每个会话使用独立的 Provider 实例
 */
/** Nest 聊天接口在标准模型参数之外必须知道消息所属会话。 */
export interface ChatRequestParams extends XModelParams {
  conversationId: string;
}

/**
 * Provider 内部保存流请求状态，必须按会话和模型隔离；切换回来时可以安全复用。
 */
const providerCaches = new Map<
  string,
  DeepSeekChatProvider<ChatMessage, ChatRequestParams, ModelStreamOutput>
>();

/** DeepSeekChatProvider 所需的 OpenAI 兼容 SSE 字段集合。 */
export type ModelStreamOutput = Partial<Record<SSEFields, XModelResponse>>;

/**
 * 只发送给模型、不写入本地消息列表的格式约束。
 * reasoning_content 并不天然保证是 Markdown，因此需要明确要求多行代码使用围栏代码块。
 */
const MARKDOWN_SYSTEM_MESSAGE: XModelMessage = {
  role: 'system',
  content: [
    '请使用 GitHub Flavored Markdown 组织推理过程和正式回答。',
    '所有多行代码都必须使用三个反引号围栏，并在开头标注准确的语言，例如 javascript、typescript、html 或 bash。',
    '不要把多行代码作为普通段落输出；行内代码请使用单反引号。',
  ].join('\n'),
};

/**
 * 在真正发出的请求中注入 Markdown 格式要求，同时避免把 system 消息显示在聊天列表里。
 */
class MarkdownDeepSeekChatProvider extends DeepSeekChatProvider<
  ChatMessage,
  ChatRequestParams,
  ModelStreamOutput
> {
  override transformParams(
    requestParams: Partial<ChatRequestParams>,
    options: XRequestOptions<
      ChatRequestParams,
      ModelStreamOutput,
      ChatMessage
    >,
  ): ChatRequestParams {
    const params = super.transformParams(requestParams, options);

    return {
      ...params,
      messages: [MARKDOWN_SYSTEM_MESSAGE, ...(params.messages || [])],
    };
  }
}

/**
 * Provider 工厂函数
 * 为每个会话创建或获取 Provider 实例
 * @param conversationKey 会话标识
 * @param modelId 当前会话选中的模型 ID
 * @param onSettled 请求结束后刷新服务端会话摘要
 * @returns DeepSeekChatProvider 实例
 */
export const providerFactory = (
  conversationKey: string,
  modelId: string,
  onSettled: () => void,
) => {
  // 同一会话切换模型时创建新实例，防止缓存的默认请求参数仍指向旧模型。
  const cacheKey = `${conversationKey}:${modelId}`;

  if (!providerCaches.get(cacheKey)) {
    providerCaches.set(
      cacheKey,
      new MarkdownDeepSeekChatProvider({
        request: XRequest<
          ChatRequestParams,
          ModelStreamOutput,
          ChatMessage
        >('/api/ai-server/chat/completions', {
          manual: true,
          // Docker 沙箱生成 PPT/PDF 等产物可能跨越多次模型与工具调用。
          timeout: 310_000,
          streamTimeout: 310_000,
          params: {
            stream: true,
            model: modelId,
            conversationId: conversationKey,
          },
          callbacks: {
            // 成功和失败都可能已经写入用户消息，因此两种结果都刷新会话标题。
            onSuccess: onSettled,
            onError: onSettled,
          },
        }),
      }),
    );
  }
  return providerCaches.get(cacheKey);
};

/**
 * 历史消息工厂函数
 * 根据会话标识获取历史消息
 * @param conversationKey 会话标识
 * @returns 历史消息数组
 */
export const historyMessageFactory = async ({
  conversationKey,
}: {
  conversationKey?: string;
}): Promise<DefaultMessageInfo<ChatMessage>[]> => {
  if (!conversationKey) return [];

  const conversation = await getConversation(conversationKey);

  return conversation.messages.map((message) => {
    // 思考内容重新包装成现有 Markdown 自定义标签，保持刷新前后的展示一致。
    const content =
      message.role === 'assistant' && message.reasoningContent
        ? `<think status="done">\n\n${message.reasoningContent}\n\n</think>\n\n${message.content}`
        : message.content;

    return {
      id: message.id,
      status: 'success',
      message: {
        role: message.role,
        content,
        images: message.images,
      },
    };
  });
};

/**
 * 获取消息角色配置
 * 定义用户和助手消息的显示方式
 * @param className Markdown 主题类名
 * @returns 角色配置对象
 */
export const getRole = (className: string): BubbleListProps['role'] => ({
  /** 助手消息配置 */
  assistant: {
    placement: 'start',
    variant: 'borderless',
    rootClassName: 'assistant-chat-bubble',
    /** 思考时间线和正式回答分别渲染，避免工具记录混入正文。 */
    contentRender: (content: string, { status }) => {
      return (
        <AssistantMessageContent
          content={content}
          className={className}
          status={status}
        />
      );
    },
  },
  /** 用户消息配置 */
  user: { placement: 'end' },
});
