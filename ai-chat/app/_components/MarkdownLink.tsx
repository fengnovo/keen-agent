import React from 'react';

import { WebPreview } from './WebPreview';

const PREVIEW_URL_PATTERN =
  /^\/api\/ai-server\/previews\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{20,}\/index\.html$/i;

/**
 * 只有服务端签发格式的同源相对 URL 才升级为 iframe。
 * 模型输出的任意外链、data URL 或伪造路径仍按普通链接处理。
 */
export const MarkdownLink: React.FC<
  React.AnchorHTMLAttributes<HTMLAnchorElement>
> = ({ children, href, title }) => {
  if (href && PREVIEW_URL_PATTERN.test(href)) {
    const previewTitle =
      typeof children === 'string' ? children : title || '生成的网站';
    return <WebPreview src={href} title={previewTitle} />;
  }

  return (
    <a
      href={href}
      title={title}
      target='_blank'
      rel='noopener noreferrer'
      referrerPolicy='no-referrer'
    >
      {children}
    </a>
  );
};
