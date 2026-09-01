/**
 * 聊天输入框组件
 * 包含附件上传、提示词、输入框等
 */

import React, { useRef, useState } from 'react';
import { Button, Flex, Select, Space, Upload } from 'antd';
import {
  BulbOutlined,
  CloudUploadOutlined,
  PaperClipOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Sender, Attachments } from '@ant-design/x';
import type { AttachmentsRef } from '@ant-design/x/es/attachments';
import type { GetProp } from 'antd';
import { useStyle } from '../_utils/styles';
import { texts } from '../_utils/local';
import {
  IMAGE_ACCEPT,
  isSupportedImage,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_TOTAL_BYTES,
} from '../_utils/image';

type AttachmentItems = NonNullable<GetProp<typeof Attachments, 'items'>>;

/**
 * ChatSender 组件属性
 */
interface ChatSenderProps {
  /** 输入框值 */
  inputValue: string;
  /** 设置输入框值 */
  setInputValue: (val: string) => void;
  /** 提交消息回调 */
  onSubmit: (val: string, files: File[]) => Promise<boolean>;
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
  /** 当前会话是否启用深度思考 */
  thinkingEnabled: boolean;
  /** 当前会话是否允许 Agent 调用工具 */
  toolsEnabled: boolean;
  /** 正在持久化的会话能力 */
  updatingFeature?: 'thinkingEnabled' | 'toolsEnabled';
  /** 修改当前会话的深度思考开关 */
  onThinkingChange: (enabled: boolean) => void;
  /** 修改当前会话的工具调用开关 */
  onToolsChange: (enabled: boolean) => void;
  /** 模型列表加载状态 */
  modelsLoading?: boolean;
  /** 会话初始化状态 */
  disabled?: boolean;
  /** 展示图片校验或读取错误 */
  onAttachmentError: (error: string) => void;
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
  thinkingEnabled,
  toolsEnabled,
  updatingFeature,
  onThinkingChange,
  onToolsChange,
  modelsLoading,
  disabled,
  onAttachmentError,
}) => {
  const { styles } = useStyle();
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachmentItems>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const attachmentsRef = useRef<AttachmentsRef>(null);
  const submittingRef = useRef(false);
  const interactionDisabled = disabled || isRequesting || isPreparing;
  const featureDisabled = interactionDisabled || Boolean(updatingFeature);

  const beforeUpload: NonNullable<
    GetProp<typeof Attachments, 'beforeUpload'>
  > = (file, selectedFiles) => {
    if (!isSupportedImage(file)) {
      onAttachmentError(texts.unsupportedImageType);
      return Upload.LIST_IGNORE;
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      onAttachmentError(texts.imageTooLarge);
      return Upload.LIST_IGNORE;
    }

    const selectedIndex = selectedFiles.findIndex(
      (selectedFile) => selectedFile.uid === file.uid,
    );
    const acceptedBatch = selectedFiles
      .slice(0, selectedIndex + 1)
      .filter(
        (selectedFile) =>
          isSupportedImage(selectedFile) &&
          selectedFile.size <= MAX_IMAGE_FILE_BYTES,
      );

    if (attachedFiles.length + acceptedBatch.length > MAX_IMAGE_COUNT) {
      onAttachmentError(texts.tooManyImages);
      return Upload.LIST_IGNORE;
    }

    const currentSize = attachedFiles.reduce(
      (total, attachedFile) => total + (attachedFile.size ?? 0),
      0,
    );
    const selectedSize = acceptedBatch.reduce(
      (total, selectedFile) => total + selectedFile.size,
      0,
    );

    if (currentSize + selectedSize > MAX_IMAGE_TOTAL_BYTES) {
      onAttachmentError(texts.imagesTooLarge);
      return Upload.LIST_IGNORE;
    }

    // 阻止 antd 发起独立上传；图片会在提交消息时一并发送给聊天接口。
    return false;
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    submittingRef.current = true;
    setIsPreparing(true);

    try {
      const files = attachedFiles.flatMap((attachedFile) =>
        attachedFile.originFileObj ? [attachedFile.originFileObj] : [],
      );
      const submitted = await onSubmit(inputValue, files);

      if (submitted) {
        setInputValue('');
        setAttachedFiles([]);
        setAttachmentsOpen(false);
      }
    } finally {
      submittingRef.current = false;
      setIsPreparing(false);
    }
  };

  /** 附件上传头部 */
  const senderHeader = (
    <Sender.Header
      title={texts.uploadFile}
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      // 关闭预览区时仍保留隐藏的 file input，纸夹按钮才能直接唤起系统选择器。
      forceRender
      styles={{ content: { padding: 0 } }}
    >
      <Attachments
        ref={attachmentsRef}
        accept={IMAGE_ACCEPT}
        multiple
        beforeUpload={beforeUpload}
        items={attachedFiles}
        onChange={(info) => {
          setAttachedFiles(info.fileList);
          setAttachmentsOpen(info.fileList.length > 0);
        }}
        disabled={interactionDisabled}
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
        onSubmit={() => void handleSubmit()}
        onChange={setInputValue}
        onPasteFile={(files) => {
          Array.from(files).forEach((file) => {
            attachmentsRef.current?.upload(file);
          });
        }}
        onCancel={() => {
          abort();
        }}
        suffix={false}
        footer={(originalNode) => (
          <Flex justify='space-between' align='center' gap={8} wrap>
            <Space size={8} wrap>
              <Sender.Switch
                value={thinkingEnabled}
                loading={updatingFeature === 'thinkingEnabled'}
                disabled={featureDisabled}
                icon={<BulbOutlined />}
                role='switch'
                aria-label={texts.deepThinking}
                aria-checked={thinkingEnabled}
                title={texts.deepThinkingDescription}
                onChange={onThinkingChange}
              >
                {texts.deepThinking}
              </Sender.Switch>
              <Sender.Switch
                value={toolsEnabled}
                loading={updatingFeature === 'toolsEnabled'}
                disabled={featureDisabled}
                icon={<ToolOutlined />}
                role='switch'
                aria-label={texts.toolCalling}
                aria-checked={toolsEnabled}
                title={texts.toolCallingDescription}
                onChange={onToolsChange}
              >
                {texts.toolCalling}
              </Sender.Switch>
            </Space>

            <Space size={4}>
              {/* 模型属于当前会话；请求期间锁定，避免一次流中途切换模型。 */}
              <Select
                aria-label={texts.selectModel}
                className={styles.modelSelect}
                variant='borderless'
                value={selectedModelId}
                options={modelOptions}
                loading={modelsLoading}
                disabled={
                  disabled || isRequesting || modelOptions.length === 0
                }
                optionFilterProp='label'
                popupMatchSelectWidth={false}
                onChange={onModelChange}
              />
              <Button
                type='text'
                aria-label={texts.addImage}
                title={texts.addImage}
                icon={<PaperClipOutlined style={{ fontSize: 18 }} />}
                disabled={interactionDisabled}
                onClick={() =>
                  attachmentsRef.current?.select({
                    accept: IMAGE_ACCEPT,
                    multiple: true,
                  })
                }
              />
              {originalNode}
            </Space>
          </Flex>
        )}
        loading={isRequesting || isPreparing}
        disabled={disabled}
        className={styles.sender}
        allowSpeech
        placeholder={texts.askOrInputUseSkills}
      />
    </Flex>
  );
};
