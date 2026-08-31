/**
 * 独立聊天页面组件
 * 整合侧边栏、聊天列表、输入框等子组件
 */

'use client';

import React, { useRef, useState } from 'react';
import { XProvider } from '@ant-design/x';
import { message } from 'antd';
import { useXChat, useXConversations } from '@ant-design/x-sdk';
import { BubbleListRef } from '@ant-design/x/es/bubble';
import '@ant-design/x-markdown/themes/light.css';

import { useStyle } from './_utils/styles';
import { ChatContext, ChatMessage } from './_utils/types';
import { DEFAULT_CONVERSATIONS_ITEMS } from './_utils/config';
import { providerFactory, historyMessageFactory } from './_utils/provider';
import locale, { texts } from './_utils/local';
import { designTheme } from './_utils/theme';
import { ChatSide } from './_components/ChatSide';
import { ChatList } from './_components/ChatList';
import { ChatSender } from './_components/ChatSender';

/**
 * Markdown 主题 hook
 * 返回 Markdown 主题类名
 */
function useMarkdownTheme(): [string] {
  return ['x-markdown-light x-markdown-theme'];
}

/**
 * 独立聊天页面
 * 包含会话管理、消息发送、AI 回复等功能
 */
const Independent: React.FC = () => {
  const { styles } = useStyle();

  // ==================== State ====================

  /** 会话管理 */
  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    setConversations,
  } = useXConversations({
    defaultConversations: DEFAULT_CONVERSATIONS_ITEMS,
    defaultActiveConversationKey: DEFAULT_CONVERSATIONS_ITEMS[0].key,
  });

  /** Markdown 主题类名 */
  const [className] = useMarkdownTheme();

  /** 消息提示 */
  const [, contextHolder] = message.useMessage();

  /** 输入框值 */
  const [inputValue, setInputValue] = useState('');

  /** 消息列表 ref */
  const listRef = useRef<BubbleListRef>(null);

  // ==================== Runtime ====================

  /** 聊天核心逻辑 */
  const { onRequest, messages, isRequesting, abort, onReload, setMessage } =
    useXChat<ChatMessage>({
      /** 每个会话使用独立的 Provider */
      provider: providerFactory(activeConversationKey),
      conversationKey: activeConversationKey,
      defaultMessages: historyMessageFactory(activeConversationKey),
      /** 请求占位符 */
      requestPlaceholder: () => {
        return {
          content: texts.noData,
          role: 'assistant',
        };
      },
      /** 请求失败回调 */
      requestFallback: (_, { error, errorInfo, messageInfo }) => {
        if (error.name === 'AbortError') {
          return {
            content: messageInfo?.message?.content || texts.requestAborted,
            role: 'assistant',
          };
        }
        return {
          content: errorInfo?.error?.message || texts.requestFailed,
          role: 'assistant',
        };
      },
    });

  // ==================== Event ====================

  /**
   * 提交消息
   * @param val 用户输入内容
   */
  const onSubmit = (val: string) => {
    if (!val) return;
    onRequest({
      messages: [{ role: 'user', content: val }],
    });
    listRef.current?.scrollTo({ top: 'bottom' });
    setActiveConversationKey(activeConversationKey);
  };

  // ==================== Render ====================

  return (
    <XProvider locale={locale} theme={designTheme}>
      <ChatContext.Provider value={{ onReload, setMessage }}>
        {contextHolder}
        <div className={styles.layout}>
          {/* 侧边栏 */}
          <ChatSide
            conversations={conversations}
            activeConversationKey={activeConversationKey}
            setActiveConversationKey={setActiveConversationKey}
            addConversation={addConversation}
            setConversations={setConversations}
            messagesLength={messages.length}
          />

          {/* 聊天区域 */}
          <div className={styles.chat}>
            <ChatList
              messages={messages}
              className={className}
              listRef={listRef}
            />
            <ChatSender
              inputValue={inputValue}
              setInputValue={setInputValue}
              onSubmit={onSubmit}
              isRequesting={isRequesting}
              abort={abort}
            />
          </div>
        </div>
      </ChatContext.Provider>
    </XProvider>
  );
};

export default Independent;
