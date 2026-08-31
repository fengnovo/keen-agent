/**
 * 聊天输入框组件
 * 包含附件上传、提示词、输入框等
 */

import React, { useState } from 'react';
import { Button, Flex, Select, Space } from 'antd';
import { PaperClipOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { Sender, Attachments } from '@ant-design/x';
import type { GetProp } from 'antd';
import { useStyle } from '../_utils/styles';
import { texts } from '../_utils/local';

/**
 * ChatSender 组件属性
 */
interface ChatSenderProps {
  /** 输入框值 */
  inputValue: string;
  /** 设置输入框值 */
  setInputValue: (val: string) => void;
  /** 提交消息回调 */
  onSubmit: (val: string) => void;
  /** 是否正在请求中 */
  isRequesting: boolean;
  /** 取消请求回调 */
  abort: () => void;
  /** 当前可选模型 */
  modelOptions: Array<{ label: string; value: string }>;
  /** 当前会话模型 */
  selectedModelId?: string;
  /** 修改当前会话模型 */
  onModelChange: (modelId: string) => void;
  /** 模型列表加载状态 */
  modelsLoading?: boolean;
  /** 会话初始化状态 */
  disabled?: boolean;
}

/**
 * 聊天输入框组件
 * 包含附件上传、提示词、输入框等
 */
export const ChatSender: React.FC<ChatSenderProps> = ({
  inputValue,
  setInputValue,
  onSubmit,
  isRequesting,
  abort,
  modelOptions,
  selectedModelId,
  onModelChange,
  modelsLoading,
  disabled,
}) => {
  const { styles } = useStyle();
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<
    GetProp<typeof Attachments, 'items'>
  >([]);

  /** 附件上传头部 */
  const senderHeader = (
    <Sender.Header
      title={texts.uploadFile}
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      styles={{ content: { padding: 0 } }}
    >
      <Attachments
        beforeUpload={() => false}
        items={attachedFiles}
        onChange={(info) => setAttachedFiles(info.fileList)}
        placeholder={(type) =>
          type === 'drop'
            ? { title: texts.dropFileHere }
            : {
                icon: <CloudUploadOutlined />,
                title: texts.uploadFiles,
                description: texts.clickOrDragFilesToUpload,
              }
        }
      />
    </Sender.Header>
  );

  return (
    <Flex
      vertical
      align='center'
      style={{
        margin: 8,
      }}
    >
      {/* 输入框 */}
      <Sender
        value={inputValue}
        header={senderHeader}
        onSubmit={() => {
          onSubmit(inputValue);
          setInputValue('');
        }}
        onChange={setInputValue}
        onCancel={() => {
          abort();
        }}
        prefix={
          <Button
            type='text'
            icon={<PaperClipOutlined style={{ fontSize: 18 }} />}
            onClick={() => setAttachmentsOpen(!attachmentsOpen)}
          />
        }
        suffix={(originalNode) => (
          <Space size={4}>
            {/* 模型属于当前会话；请求期间锁定，避免一次流中途切换模型。 */}
            <Select
              aria-label={texts.selectModel}
              className={styles.modelSelect}
              variant='borderless'
              value={selectedModelId}
              options={modelOptions}
              loading={modelsLoading}
              disabled={disabled || isRequesting || modelOptions.length === 0}
              optionFilterProp='label'
              popupMatchSelectWidth={false}
              onChange={onModelChange}
            />
            {originalNode}
          </Space>
        )}
        loading={isRequesting}
        disabled={disabled}
        className={styles.sender}
        allowSpeech
        placeholder={texts.askOrInputUseSkills}
      />
    </Flex>
  );
};
