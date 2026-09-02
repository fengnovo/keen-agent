/**
 * 侧边栏组件
 * 包含 Logo、会话列表、用户信息等
 */

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Button, Input, Modal } from 'antd';
import { Conversations } from '@ant-design/x';
import type { ConversationData } from '@ant-design/x-sdk';
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useStyle } from '../_utils/styles';
import { texts } from '../_utils/local';
import type { ModelRegistry } from '../_utils/model-api';

const ModelManagerModal = dynamic(
  () =>
    import('./ModelManagerModal').then((module) => module.ModelManagerModal),
  { ssr: false },
);

const PluginManagerModal = dynamic(
  () =>
    import('./PluginManagerModal').then((module) => module.PluginManagerModal),
  { ssr: false },
);

const DEFAULT_SIDE_WIDTH = 280;
const MIN_SIDE_WIDTH = 220;
const MAX_SIDE_WIDTH = 480;
const COLLAPSED_SIDE_WIDTH = 44;
const KEYBOARD_RESIZE_STEP = 16;
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

const clampSideWidth = (width: number) =>
  Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, width));

/**
 * ChatSide 组件属性
 */
interface ChatSideProps {
  /** 会话列表 */
  conversations: ConversationData[];
  /** 当前活动会话标识 */
  activeConversationKey: string;
  /** 设置活动会话 */
  setActiveConversationKey: (key: string) => void;
  /** 新建服务端会话 */
  onCreateConversation: () => Promise<boolean>;
  /** 删除服务端会话 */
  onDeleteConversation: (key: string) => Promise<boolean>;
  /** 重命名服务端会话 */
  onRenameConversation: (key: string, title: string) => Promise<boolean>;
  /** 模型注册表发生变化 */
  onModelRegistryChange: (registry: ModelRegistry) => void;
}

/**
 * 侧边栏组件
 * 显示 Logo、会话列表、用户头像等
 */
export const ChatSide: React.FC<ChatSideProps> = ({
  conversations,
  activeConversationKey,
  setActiveConversationKey,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onModelRegistryChange,
}) => {
  const { styles } = useStyle();
  const [sideWidth, setSideWidth] = useState(DEFAULT_SIDE_WIDTH);
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );
  const [resizing, setResizing] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [conversationOperation, setConversationOperation] = useState('');
  const [renamingConversation, setRenamingConversation] =
    useState<ConversationData>();
  const [renameValue, setRenameValue] = useState('');
  /** 保存拖动开始位置，移动过程中无需因高频变化触发额外状态更新。 */
  const resizeStart = useRef({ pointerX: 0, width: DEFAULT_SIDE_WIDTH });

  /** 仅在拖动期间注册全局监听，结束或卸载时恢复页面交互样式。 */
  useEffect(() => {
    if (!resizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handlePointerMove = (event: PointerEvent) => {
      const offset = event.clientX - resizeStart.current.pointerX;
      setSideWidth(clampSideWidth(resizeStart.current.width + offset));
    };

    const stopResizing = () => setResizing(false);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    window.addEventListener('blur', stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      window.removeEventListener('blur', stopResizing);
    };
  }, [resizing]);

  /** 进入窄屏时自动收起侧边栏，避免遮住聊天内容。 */
  useEffect(() => {
    const mobileMedia = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setCollapsed(event.matches);
    };

    mobileMedia.addEventListener('change', handleViewportChange);
    return () => {
      mobileMedia.removeEventListener('change', handleViewportChange);
    };
  }, []);

  const collapseOnMobile = () => {
    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      setCollapsed(true);
    }
  };

  /** 等待 Nest 创建成功后再收起移动端侧栏。 */
  const handleCreateConversation = async () => {
    setConversationOperation('create');
    try {
      if (await onCreateConversation()) collapseOnMobile();
    } finally {
      setConversationOperation('');
    }
  };

  /** 用操作 key 只锁定当前删除项，其他会话仍可浏览。 */
  const handleDeleteConversation = async (key: string) => {
    setConversationOperation(`delete:${key}`);
    try {
      await onDeleteConversation(key);
    } finally {
      setConversationOperation('');
    }
  };

  /** 菜单项标签含“当前会话”前缀时，仍从原始列表取真实标题。 */
  const openRenameConversation = (conversation: ConversationData) => {
    const originalConversation = conversations.find(
      (item) => item.key === conversation.key,
    );

    setRenamingConversation(originalConversation ?? conversation);
    setRenameValue(
      String(originalConversation?.label ?? conversation.label ?? ''),
    );
  };

  const handleRenameConversation = async () => {
    const title = renameValue.trim();
    if (!renamingConversation || !title) return;

    setConversationOperation(`rename:${renamingConversation.key}`);
    try {
      if (await onRenameConversation(renamingConversation.key, title)) {
        setRenamingConversation(undefined);
      }
    } finally {
      setConversationOperation('');
    }
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStart.current = {
      pointerX: event.clientX,
      width: sideWidth,
    };
    setResizing(true);
  };

  /** 支持方向键和 Home/End 调整侧栏，保证拖动条可由键盘操作。 */
  const handleResizeKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    let nextWidth: number | undefined;

    if (event.key === 'ArrowLeft') {
      nextWidth = sideWidth - KEYBOARD_RESIZE_STEP;
    } else if (event.key === 'ArrowRight') {
      nextWidth = sideWidth + KEYBOARD_RESIZE_STEP;
    } else if (event.key === 'Home') {
      nextWidth = MIN_SIDE_WIDTH;
    } else if (event.key === 'End') {
      nextWidth = MAX_SIDE_WIDTH;
    }

    if (nextWidth !== undefined) {
      event.preventDefault();
      setSideWidth(clampSideWidth(nextWidth));
    }
  };

  const sideClassName = [
    styles.side,
    collapsed ? styles.sideCollapsed : '',
    resizing ? styles.sideResizing : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <aside
      className={sideClassName}
      style={{ width: collapsed ? COLLAPSED_SIDE_WIDTH : sideWidth }}
    >
      {/* Logo 与侧栏开关 */}
      <div className={styles.sideHeader}>
        {!collapsed && (
          <div className={styles.logo}>
            <Image
              src='./keen-ai-logo.png'
              draggable={false}
              alt='logo'
              width={24}
              height={24}
              unoptimized
            />
            <span>Keen AI</span>
          </div>
        )}
        <Button
          type='text'
          shape='circle'
          className={styles.sideToggle}
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? texts.expandSidebar : texts.collapseSidebar}
          aria-label={collapsed ? texts.expandSidebar : texts.collapseSidebar}
          aria-expanded={!collapsed}
          data-sidebar-toggle
        />
      </div>

      {/* 移动端新建会话入口 */}
      <Button
        shape='circle'
        size='large'
        className={styles.mobileNewConversation}
        icon={<PlusOutlined />}
        loading={conversationOperation === 'create'}
        onClick={() => void handleCreateConversation()}
        title={texts.startNewConversation}
        aria-label={texts.startNewConversation}
      />

      {/* 会话管理 */}
      {!collapsed && (
        <Conversations
          creation={{
            disabled: conversationOperation === 'create',
            onClick: () => void handleCreateConversation(),
          }}
          items={conversations.map(({ key, label, ...other }) => ({
            key,
            label:
              key === activeConversationKey
                ? `[${texts.curConversation}]${label}`
                : label,
            ...other,
          }))}
          className={styles.conversations}
          activeKey={activeConversationKey}
          onActiveChange={(key) => {
            setActiveConversationKey(key);
            collapseOnMobile();
          }}
          groupable
          styles={{ item: { padding: '0 8px' } }}
          menu={(conversation) => ({
            items: [
              {
                label: texts.rename,
                key: 'rename',
                icon: <EditOutlined />,
                onClick: () => openRenameConversation(conversation),
              },
              {
                label: texts.delete,
                key: 'delete',
                icon: <DeleteOutlined />,
                danger: true,
                disabled:
                  conversationOperation === `delete:${conversation.key}`,
                onClick: () => void handleDeleteConversation(conversation.key),
              },
            ],
          })}
        />
      )}

      {/* 模型与插件都是全局 Agent 配置，入口并列放在侧栏底部。 */}
      <div
        className={`${styles.modelManagerEntry} ${
          collapsed ? styles.modelManagerEntryCollapsed : ''
        }`}
      >
        <Button
          block={!collapsed}
          type='text'
          shape={collapsed ? 'circle' : 'default'}
          icon={<SettingOutlined />}
          title={texts.modelManagement}
          aria-label={texts.modelManagement}
          onClick={() => setModelManagerOpen(true)}
        >
          {!collapsed && texts.modelManagement}
        </Button>
        <Button
          block={!collapsed}
          type='text'
          shape={collapsed ? 'circle' : 'default'}
          icon={<AppstoreOutlined />}
          title={texts.pluginManagement}
          aria-label={texts.pluginManagement}
          onClick={() => setPluginManagerOpen(true)}
        >
          {!collapsed && texts.pluginManagement}
        </Button>
      </div>

      {modelManagerOpen ? (
        <ModelManagerModal
          open
          onClose={() => setModelManagerOpen(false)}
          onRegistryChange={onModelRegistryChange}
        />
      ) : null}

      {pluginManagerOpen ? (
        <PluginManagerModal
          open
          onClose={() => setPluginManagerOpen(false)}
        />
      ) : null}

      <Modal
        open={Boolean(renamingConversation)}
        title='重命名会话'
        okText='保存'
        cancelText='取消'
        confirmLoading={conversationOperation.startsWith('rename:')}
        okButtonProps={{ disabled: !renameValue.trim() }}
        onOk={() => void handleRenameConversation()}
        onCancel={() => setRenamingConversation(undefined)}
      >
        <Input
          value={renameValue}
          maxLength={60}
          autoFocus
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void handleRenameConversation()}
        />
      </Modal>

      {/* 侧栏宽度调整条 */}
      {!collapsed && (
        <div
          className={`${styles.resizeHandle} ${resizing ? styles.resizeHandleActive : ''}`}
          role='separator'
          tabIndex={0}
          aria-label={texts.resizeSidebar}
          aria-orientation='vertical'
          aria-valuemin={MIN_SIDE_WIDTH}
          aria-valuemax={MAX_SIDE_WIDTH}
          aria-valuenow={sideWidth}
          title={texts.resizeSidebar}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={() => setSideWidth(DEFAULT_SIDE_WIDTH)}
        />
      )}
    </aside>
  );
};
