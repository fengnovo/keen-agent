'use client';

import React, { useCallback, useState } from 'react';
import { Button, Checkbox, Input, Modal, Radio, message } from 'antd';
import type { AskUserRequest } from '../_utils/reasoning-trace';
import { resumeAskUser } from '../_utils/conversation-api';

interface AskUserModalProps {
  runId: string;
  request: AskUserRequest;
}

/**
 * AI 主动发起的 ask_user 弹窗：支持单选、多选和“其他”自定义输入。
 * 用户确认后回填答案，服务端 resume 中断的 Agent 流继续执行。
 */
export const AskUserModal: React.FC<AskUserModalProps> = ({
  runId,
  request,
}) => {
  const [selected, setSelected] = useState<number[]>([]);
  const [customText, setCustomText] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggle = useCallback(
    (index: number) => {
      setCustomMode(false);
      if (request.multiple) {
        setSelected((current) =>
          current.includes(index)
            ? current.filter((item) => item !== index)
            : [...current, index].sort((a, b) => a - b),
        );
      } else {
        setSelected([index]);
      }
    },
    [request.multiple],
  );

  const submit = useCallback(async () => {
    const selections = selected
      .filter((index) => index >= 0 && index < request.options.length)
      .map((index) => ({
        index,
        label: request.options[index]!.label,
      }));
    const custom = request.allowCustom ? customText.trim() : '';
    if (selections.length === 0 && !custom) return;

    setSubmitting(true);
    try {
      await resumeAskUser(runId, {
        selections: request.multiple ? selections : selections.slice(0, 1),
        ...(custom ? { customText: custom } : {}),
      });
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '提交选择失败',
      );
      setSubmitting(false);
    }
  }, [customText, request.allowCustom, request.multiple, request.options, runId, selected]);

  return (
    <Modal
      open
      closable={false}
      maskClosable={false}
      title={request.question}
      footer={[
        <Button key='cancel' disabled>
          等待选择
        </Button>,
        <Button
          key='submit'
          type='primary'
          onClick={() => void submit()}
          loading={submitting}
          disabled={
            selected.length === 0 &&
            !(request.allowCustom && customText.trim())
          }
        >
          确认
        </Button>,
      ]}
    >
      <div className='ask-user-options'>
        {request.options.map((option, index) => (
          <div key={index} className='ask-user-option'>
            {request.multiple ? (
              <Checkbox
                checked={selected.includes(index)}
                onChange={() => toggle(index)}
              >
                <span className='ask-user-label'>{option.label}</span>
                {option.description ? (
                  <span className='ask-user-description'>
                    {option.description}
                  </span>
                ) : null}
              </Checkbox>
            ) : (
              <Radio
                checked={selected.includes(index)}
                onChange={() => toggle(index)}
              >
                <span className='ask-user-label'>{option.label}</span>
                {option.description ? (
                  <span className='ask-user-description'>
                    {option.description}
                  </span>
                ) : null}
              </Radio>
            )}
          </div>
        ))}

        {request.allowCustom ? (
          <div className='ask-user-option'>
            {request.multiple ? (
              <Checkbox
                checked={customMode}
                onChange={(event) => {
                  setCustomMode(event.target.checked);
                  if (!event.target.checked) setCustomText('');
                }}
              >
                其他
              </Checkbox>
            ) : (
              <Radio
                checked={customMode}
                onChange={(event) => {
                  setCustomMode(event.target.checked);
                  if (!event.target.checked) setCustomText('');
                }}
              >
                其他
              </Radio>
            )}
            {customMode ? (
              <Input
                autoFocus
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                onPressEnter={submit}
                placeholder='请输入自定义内容'
                style={{ marginTop: 8 }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
