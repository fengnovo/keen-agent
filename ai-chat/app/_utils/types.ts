/**
 * 类型定义文件
 * 定义聊天消息、上下文等核心类型
 */

import React from 'react';
import type { ActionsFeedbackProps } from '@ant-design/x';
import type { useXChat } from '@ant-design/x-sdk';
import type { XModelMessage } from '@ant-design/x-sdk';

/** 发送给视觉模型并随会话持久化的图片。 */
export interface ChatImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

/**
 * 聊天消息类型
 * 扩展 XModelMessage，添加额外的反馈信息
 */
export interface ChatMessage extends XModelMessage {
  images?: ChatImage[];
  extraInfo?: {
    feedback: ActionsFeedbackProps['value'];
  };
}

/**
 * 聊天上下文类型
 * 提供消息重载和设置功能
 */
export interface ChatContextType {
  onReload?: ReturnType<typeof useXChat>['onReload'];
  setMessage?: ReturnType<typeof useXChat<ChatMessage>>['setMessage'];
}

/**
 * 聊天上下文
 * 用于在组件间共享消息操作功能
 */
export const ChatContext = React.createContext<ChatContextType>({});
