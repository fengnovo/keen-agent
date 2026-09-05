'use client';

import React from 'react';
import {
  CloseCircleOutlined,
  DownOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  ReadOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { ThoughtChain } from '@ant-design/x';
import type { ThoughtChainItemType } from '@ant-design/x';

import {
  formatReasoningDuration,
  parseReasoningTrace,
  settleReasoningSteps,
  type ReasoningToolStep,
} from '../_utils/reasoning-trace';
import { MarkdownContent } from './MarkdownContent';

interface ThinkComponentProps {
  content: string;
  className: string;
  isDone: boolean;
  status?: string;
}

const getToolLabel = (name: string): string => {
  const normalized = name.split('__').at(-1)?.toLowerCase() ?? name;
  if (normalized === 'write_todos') return '规划任务';
  if (normalized === 'plan_tasks') return '规划任务';
  if (normalized === 'submit_task_result') return '提交研究结果';
  if (normalized === 'tavily_research') return '深度研究';
  if (normalized === 'task') return '委派子 Agent';
  if (normalized.includes('search')) return '搜索网页';
  if (/crawl|fetch|browse|open/.test(normalized)) return '浏览页面';
  if (/read|grep|glob|list|ls/.test(normalized)) return '读取资料';
  if (/write|edit|create/.test(normalized)) return '写入文件';
  if (/execute|run|shell/.test(normalized)) return '执行命令';
  return name.replaceAll('_', ' ');
};

const getToolIcon = (step: ReasoningToolStep): React.ReactNode => {
  if (step.status === 'running') return <LoadingOutlined spin />;
  if (step.status === 'error') return <CloseCircleOutlined />;
  if (step.status === 'stopped') return <CloseCircleOutlined />;

  const normalized = step.name.toLowerCase();
  if (normalized.includes('search')) return <SearchOutlined />;
  if (/crawl|fetch|browse|open/.test(normalized)) {
    return <FileSearchOutlined />;
  }
  if (/read|grep|glob|list|ls/.test(normalized)) return <ReadOutlined />;
  return <ToolOutlined />;
};

const getToolTitle = (step: ReasoningToolStep): string => {
  const label = getToolLabel(step.name);
  if (step.status === 'running') return `${label}中…`;
  if (step.status === 'stopped') return `${label} · 已停止，未收到完成结果`;
  if (step.status === 'error') return `${label}失败`;
  return step.outputSummary ? `${label} · ${step.outputSummary}` : `${label}完成`;
};

/**
 * 独立的思考时间线：模型推理与工具生命周期按实际发生顺序展示，
 * 不再把工具调用、耗时和正式回答堆在同一个灰色文本块中。
 */
export const ThinkComponent: React.FC<ThinkComponentProps> = React.memo(
  function ThinkComponent({ content, className, isDone, status }) {
    const [expanded, setExpanded] = React.useState(true);
    const trace = React.useMemo(() => parseReasoningTrace(content), [content]);
    const lastStepIndex = trace.steps.length - 1;
    const items = React.useMemo<ThoughtChainItemType[]>(
      () =>
        settleReasoningSteps(trace.steps, isDone).map((step, index) => {
          if (step.kind === 'reasoning') {
            return {
              key: step.key,
              icon: <span className='reasoning-step-dot' />,
              title: (
                <MarkdownContent
                  content={step.content}
                  className={className}
                  isStreaming={!isDone && index === lastStepIndex}
                  variant='reasoning'
                />
              ),
            };
          }

          return {
            key: step.key,
            icon: getToolIcon(step),
            title: getToolTitle(step),
            description: step.inputSummary,
            status:
              step.status === 'running'
                ? 'loading'
                : step.status === 'error'
                  ? 'error'
                  : undefined,
            blink: step.status === 'running',
          };
        }),
      [className, isDone, lastStepIndex, trace.steps],
    );
    const duration = isDone && trace.durationMs
      ? `（用时 ${formatReasoningDuration(trace.durationMs)}）`
      : '';
    const open = !isDone || expanded;

    return (
      <details
        className='reasoning-panel'
        open={open}
        aria-busy={!isDone}
        onToggle={(event) => {
          if (isDone) setExpanded(event.currentTarget.open);
        }}
      >
        <summary
          className='reasoning-panel-summary'
          onClick={(event) => {
            if (!isDone) event.preventDefault();
          }}
        >
          <span className='reasoning-panel-symbol' aria-hidden='true'>
            {isDone ? '✧' : <LoadingOutlined spin />}
          </span>
          <span>{!isDone ? '生成中…' : status === 'abort' ? '已停止' : status === 'error' ? '生成中断' : `已思考${duration}`}</span>
          <DownOutlined className='reasoning-panel-chevron' />
        </summary>

        {items.length > 0 ? (
          <ThoughtChain
            className='reasoning-timeline'
            items={items}
            line='solid'
            aria-label={isDone ? '思考过程' : '正在思考'}
          />
        ) : null}
      </details>
    );
  },
);
