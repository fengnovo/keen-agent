/**
 * 静态配置文件
 * 包含历史消息、默认会话、热门话题、设计指南等配置
 */

import {
  AppstoreAddOutlined,
  CommentOutlined,
  FileSearchOutlined,
  HeartOutlined,
  PaperClipOutlined,
  ProductOutlined,
  ScheduleOutlined,
  SmileOutlined,
} from '@ant-design/icons';
import type { GetProp } from 'antd';
import type { Prompts } from '@ant-design/x';
import type { DefaultMessageInfo } from '@ant-design/x-sdk';
import type { ChatMessage } from './types';
import { texts } from './local';

/**
 * 历史消息配置
 * 为不同会话预设历史消息
 */
export const HISTORY_MESSAGES: {
  [key: string]: DefaultMessageInfo<ChatMessage>[];
} = {
  'default-1': [
    {
      message: {
        role: 'user',
        content: texts.howToQuicklyInstallAndImportComponents,
      },
      status: 'success',
    },
    {
      message: {
        role: 'assistant',
        content: texts.aiMessage_2,
      },
      status: 'success',
    },
  ],
  'default-2': [
    {
      message: { role: 'user', content: texts.newAgiHybridInterface },
      status: 'success',
    },
    {
      message: {
        role: 'assistant',
        content: texts.aiMessage_1,
      },
      status: 'success',
    },
  ],
};

/**
 * 默认会话列表
 */
export const DEFAULT_CONVERSATIONS_ITEMS = [
  {
    key: 'default-0',
    label: texts.whatIsAntDesignX,
    group: texts.today,
  },
  {
    key: 'default-1',
    label: texts.howToQuicklyInstallAndImportComponents,
    group: texts.today,
  },
  {
    key: 'default-2',
    label: texts.newAgiHybridInterface,
    group: texts.yesterday,
  },
];

/**
 * 热门话题配置
 */
export const HOT_TOPICS: GetProp<typeof Prompts, 'items'>[number] = {
  key: '1',
  label: texts.hotTopics,
  children: [
    {
      key: '1-1',
      description: texts.whatComponentsAreInAntDesignX,
      icon: <span style={{ color: '#f93a4a', fontWeight: 700 }}>1</span>,
    },
    {
      key: '1-2',
      description: texts.newAgiHybridInterface,
      icon: <span style={{ color: '#ff6565', fontWeight: 700 }}>2</span>,
    },
    {
      key: '1-3',
      description: texts.whatComponentsAreInAntDesignX,
      icon: <span style={{ color: '#ff8f1f', fontWeight: 700 }}>3</span>,
    },
    {
      key: '1-4',
      description: texts.comeAndDiscoverNewDesignParadigm,
      icon: <span style={{ color: '#00000040', fontWeight: 700 }}>4</span>,
    },
    {
      key: '1-5',
      description: texts.howToQuicklyInstallAndImportComponents,
      icon: <span style={{ color: '#00000040', fontWeight: 700 }}>5</span>,
    },
  ],
};

/**
 * 设计指南配置
 */
export const DESIGN_GUIDE: GetProp<typeof Prompts, 'items'>[number] = {
  key: '2',
  label: texts.designGuide,
  children: [
    {
      key: '2-1',
      icon: <HeartOutlined />,
      label: texts.intention,
      description: texts.aiUnderstandsUserNeedsAndProvidesSolutions,
    },
    {
      key: '2-2',
      icon: <SmileOutlined />,
      label: texts.role,
      description: texts.aiPublicPersonAndImage,
    },
    {
      key: '2-3',
      icon: <CommentOutlined />,
      label: texts.chat,
      description: texts.howAICanExpressItselfWayUsersUnderstand,
    },
    {
      key: '2-4',
      icon: <PaperClipOutlined />,
      label: texts.interface,
      description: texts.aiBalances,
    },
  ],
};

/**
 * 输入框提示词配置
 */
export const SENDER_PROMPTS: GetProp<typeof Prompts, 'items'> = [
  {
    key: '1',
    description: texts.upgrades,
    icon: <ScheduleOutlined />,
  },
  {
    key: '2',
    description: texts.components,
    icon: <ProductOutlined />,
  },
  {
    key: '3',
    description: texts.richGuide,
    icon: <FileSearchOutlined />,
  },
  {
    key: '4',
    description: texts.installationIntroduction,
    icon: <AppstoreAddOutlined />,
  },
];

/**
 * 思考链状态配置
 * 定义不同状态下的标题和状态值
 */
export const THOUGHT_CHAIN_CONFIG = {
  loading: {
    title: texts.modelIsRunning,
    status: 'loading',
  },
  updating: {
    title: texts.modelIsRunning,
    status: 'loading',
  },
  success: {
    title: texts.modelExecutionCompleted,
    status: 'success',
  },
  error: {
    title: texts.executionFailed,
    status: 'error',
  },
  abort: {
    title: texts.aborted,
    status: 'abort',
  },
};
