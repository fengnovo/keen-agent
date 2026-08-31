/**
 * Provider 和 Role 配置
 * 包含聊天 Provider 工厂函数和消息角色配置
 */

import React from 'react';
import { GlobalOutlined } from '@ant-design/icons';
import type { BubbleListProps, ThoughtChainItemProps } from '@ant-design/x';
import { ThoughtChain } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import type { XMarkdownProps } from '@ant-design/x-markdown';
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
import { HISTORY_MESSAGES, THOUGHT_CHAIN_CONFIG } from './config';
import { ThinkComponent } from '../_components/ThinkComponent';
import { MarkdownCode } from '../_components/MarkdownCode';
import { markdownThemeStyle } from './theme';

/**
 * Provider 缓存
 * 每个会话使用独立的 Provider 实例
 */
const providerCaches = new Map<string, DeepSeekChatProvider>();

/**
 * 仅允许用于思考过程的自定义标签以原始 HTML 形式进入渲染器。
 * 模型输出的其他 HTML（尤其是未闭合的 script/style 标签）必须转义，
 * 否则浏览器会把后续 Markdown 一并吞进该标签，造成流已结束但页面被截断。
 */
const THINK_TAG_PATTERN = /^<\/?think(?:\s[^>]*)?>\s*$/i;

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);

const markdownConfig: NonNullable<XMarkdownProps['config']> = {
  renderer: {
    html({ text }) {
      return THINK_TAG_PATTERN.test(text) ? text : escapeHtml(text);
    },
  },
};

type ModelStreamOutput = Partial<Record<SSEFields, XModelResponse>>;

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
  XModelMessage,
  XModelParams,
  ModelStreamOutput
> {
  override transformParams(
    requestParams: Partial<XModelParams>,
    options: XRequestOptions<XModelParams, ModelStreamOutput, XModelMessage>,
  ): XModelParams {
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
 * @returns DeepSeekChatProvider 实例
 */
export const providerFactory = (conversationKey: string) => {
  if (!providerCaches.get(conversationKey)) {
    providerCaches.set(
      conversationKey,
      new MarkdownDeepSeekChatProvider({
        request: XRequest<
          XModelParams,
          ModelStreamOutput
        >('https://api.x.ant.design/api/big_model_glm-4.5-flash', {
          manual: true,
          params: {
            stream: true,
            // thinking: {
            //   type: 'disabled',
            // },
            model: 'glm-4.5-flash',
          },
        }),
      }),
    );
  }
  return providerCaches.get(conversationKey);
};

/**
 * 历史消息工厂函数
 * 根据会话标识获取历史消息
 * @param conversationKey 会话标识
 * @returns 历史消息数组
 */
export const historyMessageFactory = (
  conversationKey: string,
): DefaultMessageInfo<ChatMessage>[] => {
  return HISTORY_MESSAGES[conversationKey] || [];
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
    /** 消息头部 - 显示思考链状态 */
    header: (_, { status }) => {
      const config =
        THOUGHT_CHAIN_CONFIG[status as keyof typeof THOUGHT_CHAIN_CONFIG];
      return config ? (
        <ThoughtChain.Item
          style={{
            marginBottom: 8,
          }}
          status={config.status as ThoughtChainItemProps['status']}
          variant='solid'
          icon={<GlobalOutlined />}
          title={config.title}
        />
      ) : null;
    },
    /** 消息内容渲染 - 使用 Markdown 渲染 */
    contentRender: (content: string, { status }) => {
      return (
        <XMarkdown
          paragraphTag='div'
          config={markdownConfig}
          components={{
            think: ThinkComponent,
            code: MarkdownCode,
          }}
          protectCustomTagNewlines={false}
          disableCustomTagBlockMarkdown={false}
          className={className}
          style={markdownThemeStyle}
          streaming={{
            hasNextChunk: status === 'updating',
            enableAnimation: true,
            animationConfig: {
              fadeDuration: 320,
              easing: 'ease-out',
            },
            tail: {
              content: '▋',
            },
          }}
        >
          {content}
        </XMarkdown>
      );
    },
  },
  /** 用户消息配置 */
  user: { placement: 'end' },
});
