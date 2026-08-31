/**
 * 侧边栏组件
 * 包含 Logo、会话列表、用户信息等
 */

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Button } from 'antd';
import { Conversations } from '@ant-design/x';
import type { ConversationData } from '@ant-design/x-sdk';
import {
  DeleteOutlined,
  EditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useStyle } from '../_utils/styles';
import { texts } from '../_utils/local';

const ModelManagerModal = dynamic(
  () =>
    import('./ModelManagerModal').then((module) => module.ModelManagerModal),
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
  /** 添加会话 */
  addConversation: (conversation: ConversationData) => boolean;
  /** 设置会话列表 */
  setConversations: (conversations: ConversationData[]) => boolean;
  /** 当前消息数量 */
  messagesLength: number;
}

/**
 * 侧边栏组件
 * 显示 Logo、会话列表、用户头像等
 */
export const ChatSide: React.FC<ChatSideProps> = ({
  conversations,
  activeConversationKey,
  setActiveConversationKey,
  addConversation,
  setConversations,
  messagesLength,
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
  const resizeStart = useRef({ pointerX: 0, width: DEFAULT_SIDE_WIDTH });

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

  const handleCreateConversation = () => {
    if (messagesLength === 0) {
      collapseOnMobile();
      return;
    }

    const now = dayjs().valueOf().toString();
    addConversation({
      key: now,
      label: `${texts.newConversation} ${conversations.length + 1}`,
      group: texts.today,
    });
    setActiveConversationKey(now);
    collapseOnMobile();
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStart.current = {
      pointerX: event.clientX,
      width: sideWidth,
    };
    setResizing(true);
  };

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
        onClick={handleCreateConversation}
        title={texts.startNewConversation}
        aria-label={texts.startNewConversation}
      />

      {/* 会话管理 */}
      {!collapsed && (
        <Conversations
          creation={{
            onClick: handleCreateConversation,
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
              },
              {
                label: texts.delete,
                key: 'delete',
                icon: <DeleteOutlined />,
                danger: true,
                onClick: () => {
                  const newList = conversations.filter(
                    (item) => item.key !== conversation.key,
                  );
                  const newKey = newList?.[0]?.key;
                  setConversations(newList);
                  if (conversation.key === activeConversationKey) {
                    setActiveConversationKey(newKey);
                  }
                },
              },
            ],
          })}
        />
      )}

      {/* AI Agent 模型管理 */}
      <div className={styles.modelManagerEntry}>
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
      </div>

      {modelManagerOpen ? (
        <ModelManagerModal
          open
          onClose={() => setModelManagerOpen(false)}
        />
      ) : null}

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
