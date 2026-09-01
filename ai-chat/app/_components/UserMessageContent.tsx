'use client';

import { useState } from 'react';
import { Image as ImagePreview } from 'antd';
import Image from 'next/image';

import { useStyle } from '../_utils/styles';
import type { ChatImage } from '../_utils/types';

interface UserMessageContentProps {
  content: string;
  images?: ChatImage[];
}

/** 同时展示本轮问题和已经发送给视觉模型的图片。 */
export const UserMessageContent: React.FC<UserMessageContentProps> = ({
  content,
  images,
}) => {
  const { styles } = useStyle();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const imageItems =
    images?.map((image) => ({ src: image.dataUrl, alt: image.name })) ?? [];

  return (
    <div className={styles.userMessage}>
      {images?.length ? (
        <ImagePreview.PreviewGroup
          items={imageItems}
          preview={{
            open: previewOpen,
            current: previewIndex,
            onOpenChange: (open, { current }) => {
              setPreviewOpen(open);
              setPreviewIndex(current);
            },
            onChange: setPreviewIndex,
          }}
        >
          <div className={styles.userMessageImages}>
            {images.map((image, index) => (
              <button
                key={image.id}
                type='button'
                className={styles.userMessageImage}
                aria-label={`预览原图：${image.name}`}
                title={image.name}
                onClick={() => {
                  setPreviewIndex(index);
                  setPreviewOpen(true);
                }}
              >
                <Image
                  src={image.dataUrl}
                  alt={image.name}
                  fill
                  sizes='220px'
                  unoptimized
                />
              </button>
            ))}
          </div>
        </ImagePreview.PreviewGroup>
      ) : null}
      <div className={styles.userMessageText}>{content}</div>
    </div>
  );
};
