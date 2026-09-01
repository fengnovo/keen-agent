import React from 'react';

interface WebPreviewProps {
  src: string;
  title: string;
}

const containerStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  maxWidth: 960,
  minWidth: 0,
  margin: '12px 0 18px',
  overflow: 'hidden',
  border: '1px solid rgba(0, 0, 0, 0.12)',
  borderRadius: 16,
  background: '#fff',
  boxShadow: '0 14px 36px rgba(0, 0, 0, 0.08)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '10px 14px',
  color: '#202124',
  background: '#f6f6f7',
  borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
};

const titleStyle: React.CSSProperties = {
  overflow: 'hidden',
  fontWeight: 600,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const linkStyle: React.CSSProperties = {
  flex: 'none',
  color: '#1677ff',
  fontSize: 13,
};

const iframeStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'min(620px, 68vh)',
  border: 0,
  background: '#fff',
};

/**
 * 生成页面使用 opaque-origin iframe，不授予同源、表单、下载或打开新窗口权限。
 * Nest 响应的 CSP 是第二层约束；不能只依赖前端 sandbox 属性。
 */
export const WebPreview: React.FC<WebPreviewProps> = React.memo(
  function WebPreview({ src, title }) {
    return (
      // Markdown 渲染器通常把链接放在段落中，因此使用 phrasing-content 容器，
      // 避免用 section/header 替换 a 时产生非法的 p > section DOM 嵌套。
      <span
        style={containerStyle}
        role='region'
        aria-label={`网站预览：${title}`}
      >
        <span style={headerStyle}>
          <span style={titleStyle}>{title}</span>
          <a
            href={src}
            target='_blank'
            rel='noopener noreferrer'
            referrerPolicy='no-referrer'
            style={linkStyle}
          >
            新窗口打开
          </a>
        </span>
        <iframe
          src={src}
          title={`网站预览：${title}`}
          sandbox='allow-scripts allow-modals'
          referrerPolicy='no-referrer'
          loading='lazy'
          style={iframeStyle}
        />
      </span>
    );
  },
);
