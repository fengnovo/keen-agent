'use client';

import React from 'react';
import XMarkdown from '@ant-design/x-markdown';
import type { XMarkdownProps } from '@ant-design/x-markdown';

import { markdownThemeStyle } from '../_utils/theme';
import { MarkdownCode } from './MarkdownCode';
import { MarkdownLink } from './MarkdownLink';

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
      return escapeHtml(text);
    },
  },
};

interface MarkdownContentProps {
  content: string;
  className: string;
  isStreaming?: boolean;
  variant: 'answer' | 'reasoning';
}

const ANSWER_MARKDOWN_STYLE = {
  ...markdownThemeStyle,
  '--font-size': '15px',
} as React.CSSProperties;

const REASONING_MARKDOWN_STYLE = {
  ...markdownThemeStyle,
  '--font-size': '14px',
  '--text-color': '#62676f',
  '--heading-color': '#4f545c',
  '--xmd-tail-color': '#8c8c8c',
  '--margin-block': '0 0 5px 0',
  '--margin-ul-ol': '0 0 6px 20px',
  '--margin-li': '0 0 4px 0',
} as React.CSSProperties;

/** 正式回答与思考步骤共用安全 Markdown 渲染，但由独立 class 控制视觉层级。 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className,
  isStreaming = false,
  variant,
}) => (
  <XMarkdown
    paragraphTag='div'
    config={markdownConfig}
    components={{ code: MarkdownCode, a: MarkdownLink }}
    className={`${className} assistant-markdown assistant-markdown-${variant}`}
    style={
      variant === 'reasoning'
        ? REASONING_MARKDOWN_STYLE
        : ANSWER_MARKDOWN_STYLE
    }
    streaming={{
      hasNextChunk: isStreaming,
      enableAnimation: true,
      animationConfig: {
        fadeDuration: 240,
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
