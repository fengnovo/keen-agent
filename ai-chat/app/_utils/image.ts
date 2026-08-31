import type { ChatImage } from './types';

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const IMAGE_ACCEPT = SUPPORTED_IMAGE_TYPES.join(',');
export const MAX_IMAGE_COUNT = 3;
export const MAX_IMAGE_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 6 * 1024 * 1024;

const supportedImageTypeSet = new Set<string>(SUPPORTED_IMAGE_TYPES);

export const isSupportedImage = (file: Pick<File, 'type'>) =>
  supportedImageTypeSet.has(file.type);

/** 浏览器 FileReader 负责保留 MIME 类型并生成模型可直接消费的 data URL。 */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error(`无法读取图片“${file.name}”`));
      }
    };
    reader.onerror = () => reject(new Error(`无法读取图片“${file.name}”`));
    reader.readAsDataURL(file);
  });

export const filesToChatImages = async (
  files: File[],
): Promise<ChatImage[]> =>
  Promise.all(
    files.map(async (file, index) => ({
      id: `${file.lastModified}-${file.size}-${index}`,
      name: file.name,
      mimeType: file.type,
      dataUrl: await readFileAsDataUrl(file),
    })),
  );
