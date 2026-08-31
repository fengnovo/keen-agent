/**
 * 聊天列表组件
 * 显示消息列表
 */

import React from 'react';
import { Bubble } from '@ant-design/x';
import type { BubbleListRef } from '@ant-design/x/es/bubble';
import type { MessageInfo } from '@ant-design/x-sdk';
import { useStyle } from '../_utils/styles';
import { getRole } from '../_utils/provider';
import type { ChatMessage } from '../_utils/types';

/**
 * ChatList 组件属性
 */
interface ChatListProps {
  /** 消息列表 */
  messages: MessageInfo<ChatMessage>[];
  /** Markdown 主题类名 */
  className: string;
  /** 消息列表 ref */
  listRef: React.RefObject<BubbleListRef | null>;
}

/**
 * 聊天列表组件
 * 有消息时显示聊天内容，空会话保持留白
 */
export const ChatList: React.FC<ChatListProps> = ({
  messages,
  className,
  listRef,
}) => {
  const { styles } = useStyle();

  return (
    <div className={styles.chatList}>
      {messages?.length ? (
        <Bubble.List
          ref={listRef}
          items={messages?.map((i) => ({
            ...i.message,
            key: i.id,
            status: i.status,
            loading: i.status === 'loading',
            extraInfo: i.extraInfo,
          }))}
          styles={{
            root: {
              maxWidth: 940,
            },
          }}
          role={getRole(className)}
        />
      ) : null}
    </div>
  );
};
