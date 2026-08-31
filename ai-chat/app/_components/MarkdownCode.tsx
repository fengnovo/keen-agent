/**
 * Markdown 代码渲染器
 * 为块级代码提供语法高亮，并兼容未完成的流式代码块。
 */

import React from 'react';
import { Actions, CodeHighlighter } from '@ant-design/x';
import type { ComponentProps } from '@ant-design/x-markdown';

const LANGUAGE_ALIASES: Record<string, string> = {
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  py: 'python',
  rb: 'ruby',
  kt: 'kotlin',
  golang: 'go',
};

export const MarkdownCode: React.FC<ComponentProps> = ({
  block,
  children,
  className,
  lang,
  streamStatus,
}) => {
  if (typeof children !== 'string') return null;

  if (!block) {
    return <code className={className}>{children}</code>;
  }

  const languageLabel = (
    lang?.trim().split(/\s+/)[0] ||
    className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ||
    ''
  )
    .replace(/^\./, '')
    .toLowerCase();
  const language = LANGUAGE_ALIASES[languageLabel] || languageLabel;
  const isStreaming = streamStatus === 'loading';
  const codeBlockClassName = isStreaming
    ? 'markdown-code-block markdown-code-streaming'
    : 'markdown-code-block';

  return (
    <CodeHighlighter
      lang={language}
      className={codeBlockClassName}
      aria-busy={isStreaming}
      header={
        <div className='ant-codeHighlighter-header'>
          <span className='ant-codeHighlighter-header-title'>
            {languageLabel}
          </span>
          <Actions.Copy text={children} />
        </div>
      }
    >
      {children}
    </CodeHighlighter>
  );
};
