/**
 * 消息底部操作栏组件
 * 包含重试、复制、音频、反馈等操作按钮
 */

import React from 'react';
import { message, Pagination } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { Actions } from '@ant-design/x';
import { ChatContext, ChatMessage } from '../_utils/types';
import { texts } from '../_utils/local';

/**
 * Footer 组件属性
 */
interface FooterProps {
  /** 消息 ID */
  id?: string | number;
  /** 消息内容 */
  content: string;
  /** 消息状态 */
  status?: string;
  /** 额外信息 */
  extraInfo?: ChatMessage['extraInfo'];
}

/**
 * 消息底部操作栏
 * 显示消息的操作按钮，如重试、复制、反馈等
 */
export const Footer: React.FC<FooterProps> = ({
  id,
  content,
  extraInfo,
  status,
}) => {
  const context = React.useContext(ChatContext);

  /** 操作项配置 */
  const Items = [
    {
      key: 'pagination',
      actionRender: <Pagination simple total={1} pageSize={1} />,
    },
    {
      key: 'retry',
      label: texts.retry,
      icon: <SyncOutlined />,
      onItemClick: () => {
        if (id) {
          context?.onReload?.(id, {
            userAction: 'retry',
          });
        }
      },
    },
    {
      key: 'copy',
      actionRender: <Actions.Copy text={content} />,
    },
    {
      key: 'audio',
      actionRender: (
        <Actions.Audio
          onClick={() => {
            message.info(texts.isMock);
          }}
        />
      ),
    },
    {
      key: 'feedback',
      actionRender: (
        <Actions.Feedback
          styles={{
            liked: {
              color: '#f759ab',
            },
          }}
          value={extraInfo?.feedback || 'default'}
          key='feedback'
          onChange={(val) => {
            if (id) {
              context?.setMessage?.(id, () => ({
                extraInfo: {
                  feedback: val,
                },
              }));
              message.success(`${id}: ${val}`);
            } else {
              message.error('has no id!');
            }
          }}
        />
      ),
    },
  ];

  // 仅在消息完成时显示操作栏
  return status !== 'updating' && status !== 'loading' ? (
    <div style={{ display: 'flex' }}>{id && <Actions items={Items} />}</div>
  ) : null;
};
