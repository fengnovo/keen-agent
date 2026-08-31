/**
 * 聊天输入框组件
 * 包含附件上传、提示词、输入框等
 */

import React, { useState } from 'react';
import { Button, Flex } from 'antd';
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
        loading={isRequesting}
        className={styles.sender}
        allowSpeech
        placeholder={texts.askOrInputUseSkills}
      />
    </Flex>
  );
};
