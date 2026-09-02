/**
 * 样式定义文件
 * 使用 antd-style 创建组件样式
 */

import { createStyles } from 'antd-style';

/**
 * 创建聊天界面样式
 * 包含布局、侧边栏、聊天列表、输入框等样式
 */
export const useStyle = createStyles(({ token, css }) => {
  return {
    /** 主布局容器 */
    layout: css`
      width: 100%;
      height: 100vh;
      display: flex;
      overflow: hidden;
      background: ${token.colorBgContainer};
      font-family: AlibabaPuHuiTi, ${token.fontFamily}, sans-serif;
    `,
    /** 侧边栏样式 */
    side: css`
      background: ${token.colorBgLayout}80;
      height: 100%;
      display: flex;
      flex-direction: column;
      flex: none;
      position: relative;
      padding: 0 12px;
      box-sizing: border-box;
      transition: width ${token.motionDurationMid} ${token.motionEaseInOut};

      @media (max-width: 767px) {
        position: fixed;
        z-index: 1000;
        inset: 0 auto 0 0;
        max-width: calc(100vw - 56px);
        background: ${token.colorBgContainer};
        box-shadow: ${token.boxShadowSecondary};
      }
    `,
    /** 侧边栏收起样式 */
    sideCollapsed: css`
      padding: 0 6px;

      @media (max-width: 767px) {
        width: 0 !important;
        max-width: 0;
        padding: 0;
        background: transparent;
        box-shadow: none;

        [data-sidebar-toggle] {
          position: fixed;
          z-index: 1001;
          top: max(12px, env(safe-area-inset-top));
          left: max(12px, env(safe-area-inset-left));
          width: 40px;
          height: 40px;
          background: ${token.colorBgContainer};
          box-shadow: ${token.boxShadowTertiary};
        }
      }
    `,
    /** 拖动时关闭宽度动画，保证调整紧跟指针 */
    sideResizing: css`
      transition: none;
    `,
    /** 侧边栏头部样式 */
    sideHeader: css`
      min-height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;

      @media (max-width: 767px) {
        min-height: 56px;
      }
    `,
    /** Logo 区域样式 */
    logo: css`
      display: flex;
      align-items: center;
      justify-content: start;
      min-width: 0;
      padding: 0 12px;
      box-sizing: border-box;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;

      span {
        font-weight: bold;
        color: ${token.colorText};
        font-size: 16px;
      }

      img {
        filter: grayscale(1) brightness(0);
      }
    `,
    /** 侧边栏收起按钮 */
    sideToggle: css`
      flex: none;
      color: ${token.colorPrimaryActive};

      &:hover,
      &:focus-visible {
        color: ${token.colorPrimaryActive} !important;
      }
    `,
    /** 移动端右上角新建会话按钮 */
    mobileNewConversation: css`
      display: none;

      @media (max-width: 767px) {
        display: inline-flex;
        position: fixed;
        z-index: 1001;
        top: max(12px, env(safe-area-inset-top));
        right: max(12px, env(safe-area-inset-right));
        color: ${token.colorTextLightSolid};
        background: ${token.colorPrimaryActive};
        border-color: ${token.colorPrimaryActive};
        box-shadow: ${token.boxShadowTertiary};

        &:hover,
        &:focus-visible {
          color: ${token.colorTextLightSolid} !important;
          background: ${token.colorPrimaryHover} !important;
          border-color: ${token.colorPrimaryHover} !important;
        }
      }
    `,
    /** 会话列表样式 */
    conversations: css`
      overflow-y: auto;
      padding: 0;
      flex: 1;
      .ant-conversations-list {
        padding-inline-start: 0;
      }

      .ant-conversations-creation {
        color: ${token.colorTextLightSolid} !important;
        background: ${token.colorPrimaryActive} !important;
        border-color: ${token.colorPrimaryActive} !important;
        margin-bottom: 0;

        &:hover,
        &:focus-visible {
          color: ${token.colorTextLightSolid} !important;
          background: ${token.colorPrimaryHover} !important;
          border-color: ${token.colorPrimaryHover} !important;
        }
      }
    `,
    /** 模型管理入口 */
    modelManagerEntry: css`
      flex: none;
      padding: 12px 0 16px;
      display: flex;
      flex-direction: row;
      gap: 4px;

      .ant-btn {
        flex: 1;
        min-width: 0;
        padding-inline: 6px;
        color: ${token.colorTextSecondary};
      }

      .ant-btn:hover,
      .ant-btn:focus-visible {
        color: ${token.colorPrimaryActive} !important;
        /* 纯黑主色派生出的 colorPrimaryBg 过深，入口按钮统一使用浅灰反馈。 */
        background: ${token.colorFillSecondary} !important;
      }

      @media (max-width: 767px) {
        padding-bottom: max(16px, env(safe-area-inset-bottom));
      }
    `,
    /** 收起后仍保持单列圆形入口，避免两个按钮挤在 44px 宽度内。 */
    modelManagerEntryCollapsed: css`
      flex-direction: column;

      .ant-btn {
        flex: none;
      }
    `,
    /** 聊天区域样式 */
    chat: css`
      height: 100%;
      min-width: 0;
      flex: 1;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      .ant-bubble-content-updating {
        background-image: linear-gradient(
          90deg,
          ${token.colorText} 0%,
          ${token.colorTextSecondary} 100%
        );
        background-size: 100% 2px;
        background-repeat: no-repeat;
        background-position: bottom;
      }

    `,
    /** 侧边栏宽度调整条 */
    resizeHandle: css`
      position: absolute;
      z-index: 10;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: col-resize;
      touch-action: none;
      outline: none;

      &::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 3px;
        width: 2px;
        background: ${token.colorPrimary};
        opacity: 0;
        transition: opacity ${token.motionDurationFast};
      }

      &:hover::after,
      &:focus-visible::after {
        opacity: 0.65;
      }

      @media (max-width: 767px) {
        display: none;
      }
    `,
    /** 侧栏调整中的高亮样式 */
    resizeHandleActive: css`
      &::after {
        opacity: 1;
      }
    `,
    /** 聊天列表样式 */
    chatList: css`
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      width: 100%;

      /*
       * Bubble.List 的滚动层需要铺满聊天区，这样两侧留白也能响应滚轮；
       * 仅限制消息内容宽度，保持原有的居中阅读布局。
       */
      .ant-bubble-list-scroll-content {
        max-width: 940px;
        margin-inline: auto;
      }

      @media (max-width: 767px) {
        padding-top: calc(56px + env(safe-area-inset-top));
        box-sizing: border-box;
      }
    `,
    /** 用户多模态消息中的图片与文本。 */
    userMessage: css`
      min-width: 0;
    `,
    userMessageImages: css`
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: ${token.marginXS}px;
      margin-bottom: ${token.marginXS}px;
    `,
    userMessageImage: css`
      position: relative;
      display: block;
      width: min(220px, 62vw);
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border-radius: ${token.borderRadiusLG}px;
      border: 0;
      padding: 0;
      background: ${token.colorFillSecondary};
      outline: none;
      cursor: zoom-in;

      img {
        object-fit: contain;
      }

      &:focus-visible {
        box-shadow: 0 0 0 2px ${token.colorPrimaryBorder};
      }
    `,
    userMessageText: css`
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    `,
    /** 输入框样式 */
    sender: css`
      width: 100%;
      max-width: 1000px;
      margin-bottom: 10px;

      .ant-sender-actions-btn:not(.ant-btn-variant-text) {
        color: ${token.colorTextLightSolid} !important;
        background: ${token.colorPrimaryActive} !important;
        border-color: ${token.colorPrimaryActive} !important;
        opacity: 1;

        &:hover,
        &:focus-visible,
        &:active {
          color: ${token.colorTextLightSolid} !important;
          background: ${token.colorPrimaryHover} !important;
          border-color: ${token.colorPrimaryHover} !important;
        }

        &:disabled,
        &.ant-btn-disabled {
          color: ${token.colorTextLightSolid} !important;
          background: ${token.colorPrimaryActive} !important;
          border-color: ${token.colorPrimaryActive} !important;
          opacity: 1;
        }
      }
    `,
    /** 输入框中的当前会话模型选择器 */
    modelSelect: css`
      width: 170px;

      .ant-select-selection-item {
        color: ${token.colorTextSecondary};
        font-size: ${token.fontSizeSM}px;
      }

      @media (max-width: 767px) {
        width: 116px;
      }
    `,
    /** 语音按钮样式 */
    speechButton: css`
      font-size: 18px;
      color: ${token.colorText} !important;
    `,
  };
});
