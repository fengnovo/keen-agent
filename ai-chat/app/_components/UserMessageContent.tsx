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

  return (
    <div className={styles.userMessage}>
      {images?.length ? (
        <div className={styles.userMessageImages}>
          {images.map((image) => (
            <a
              key={image.id}
              className={styles.userMessageImage}
              href={image.dataUrl}
              target='_blank'
              rel='noreferrer'
              aria-label={`查看原图：${image.name}`}
              title={image.name}
            >
              <Image
                src={image.dataUrl}
                alt={image.name}
                fill
                sizes='220px'
                unoptimized
              />
            </a>
          ))}
        </div>
      ) : null}
      <div className={styles.userMessageText}>{content}</div>
    </div>
  );
};
