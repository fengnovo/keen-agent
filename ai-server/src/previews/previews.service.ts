import { Injectable, NotFoundException } from '@nestjs/common';
import { PREVIEWS_ROOT } from '@keen-agent/ai-agent/config';
import type {
  PublishedPreview,
  SandboxPreviewDirectory,
} from '@keen-agent/ai-agent/sandbox';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const PREVIEW_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_PREVIEW_FILES = 2_000;
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_DEPTH = 20;

const previewMetadataSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(PREVIEW_ID_PATTERN),
  token: z.string().min(20),
  conversationId: z.string().min(1),
  name: z.string().min(1),
  fileCount: z.number().int().positive(),
  size: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

type PreviewMetadata = z.infer<typeof previewMetadataSchema>;

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const tokenMatches = (provided: string, expected: string): boolean => {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const isWithin = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
  );
};

const safePreviewName = (value: string): string =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120) || '网站预览';

export interface ResolvedPreviewFile {
  filePath: string;
  mimeType: string;
  size: number;
  metadata: PreviewMetadata;
}

/**
 * 静态预览发布器：复制经过校验的网站目录，不运行其中任何服务端代码。
 * 发布后的文件与临时沙箱解耦，因此 Agent 本轮结束后仍可访问预览 URL。
 */
@Injectable()
export class PreviewsService {
  private readonly rootDirectory =
    process.env.PREVIEWS_PATH?.trim() || PREVIEWS_ROOT;
  private readonly publicBaseUrl = (
    process.env.PREVIEW_PUBLIC_BASE_URL || '/api/ai-server/previews'
  ).replace(/\/$/, '');

  async publish(
    preview: SandboxPreviewDirectory,
    conversationId: string,
  ): Promise<PublishedPreview> {
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const previewDirectory = join(this.rootDirectory, id);
    const siteDirectory = join(previewDirectory, 'site');
    const metadataFile = join(previewDirectory, 'metadata.json');
    const temporaryMetadataFile = `${metadataFile}.${process.pid}.tmp`;
    let fileCount = 0;
    let size = 0;

    await mkdir(siteDirectory, { recursive: true, mode: 0o700 });
    try {
      // 手动递归而不直接 fs.cp，确保复制前逐项拒绝符号链接并执行配额检查。
      const copyDirectory = async (
        sourceDirectory: string,
        destinationDirectory: string,
        depth: number,
      ): Promise<void> => {
        if (depth > MAX_PREVIEW_DEPTH) {
          throw new Error(`网站预览目录层级不能超过 ${MAX_PREVIEW_DEPTH} 层`);
        }

        for (const entry of await readdir(sourceDirectory, {
          withFileTypes: true,
        })) {
          const source = join(sourceDirectory, entry.name);
          const destination = join(destinationDirectory, entry.name);
          if (entry.isSymbolicLink()) {
            throw new Error(`网站预览不能包含符号链接：${entry.name}`);
          }
          if (entry.isDirectory()) {
            await mkdir(destination, { recursive: false, mode: 0o700 });
            await copyDirectory(source, destination, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;

          const info = await lstat(source);
          fileCount += 1;
          size += info.size;
          if (fileCount > MAX_PREVIEW_FILES || size > MAX_PREVIEW_BYTES) {
            throw new Error('网站预览超过 2000 个文件或 100 MB 限制');
          }
          await copyFile(source, destination);
        }
      };

      await copyDirectory(preview.absolutePath, siteDirectory, 0);
      const indexInfo = await stat(join(siteDirectory, 'index.html'));
      if (!indexInfo.isFile() || fileCount === 0 || size === 0) {
        throw new Error('网站预览缺少有效的 index.html');
      }

      const metadata = previewMetadataSchema.parse({
        version: 1,
        id,
        token,
        conversationId,
        name: safePreviewName(preview.name),
        fileCount,
        size,
        createdAt: new Date().toISOString(),
      });
      await writeFile(
        temporaryMetadataFile,
        `${JSON.stringify(metadata, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      await rename(temporaryMetadataFile, metadataFile);

      return {
        id,
        name: metadata.name,
        fileCount: metadata.fileCount,
        size: metadata.size,
        // 显式 index.html 避免 Next.js 去除尾斜杠后改变相对 assets 的解析目录。
        url: `${this.publicBaseUrl}/${id}/${token}/index.html`,
      };
    } catch (error) {
      await rm(previewDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async resolve(
    id: string,
    token: string,
    requestedPath = '',
  ): Promise<ResolvedPreviewFile> {
    if (!PREVIEW_ID_PATTERN.test(id) || !token) {
      throw new NotFoundException('找不到网站预览或访问凭证无效');
    }

    try {
      const previewDirectory = join(this.rootDirectory, id);
      const metadata = previewMetadataSchema.parse(
        JSON.parse(
          await readFile(join(previewDirectory, 'metadata.json'), 'utf8'),
        ),
      );
      if (metadata.id !== id || !tokenMatches(token, metadata.token)) {
        throw new Error('invalid preview token');
      }

      const siteDirectory = join(previewDirectory, 'site');
      // URL 中只接受站点内部相对路径；反斜杠、NUL、.. 和解析后越界都会拒绝。
      const normalizedPath = requestedPath
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (
        normalizedPath.includes('\u0000') ||
        normalizedPath.split('/').includes('..')
      ) {
        throw new Error('invalid preview path');
      }

      let filePath = resolve(siteDirectory, normalizedPath || 'index.html');
      if (!isWithin(siteDirectory, filePath)) {
        throw new Error('preview path escaped');
      }

      let fileInfo = await stat(filePath).catch(() => undefined);
      // 支持前端路由刷新，但真实静态资源缺失时仍返回 404。
      if ((!fileInfo || !fileInfo.isFile()) && !extname(normalizedPath)) {
        filePath = join(siteDirectory, 'index.html');
        fileInfo = await stat(filePath);
      }
      if (!fileInfo?.isFile() || (await lstat(filePath)).isSymbolicLink()) {
        throw new Error('preview file not found');
      }

      return {
        filePath,
        mimeType:
          MIME_TYPES[extname(filePath).toLowerCase()] ||
          'application/octet-stream',
        size: fileInfo.size,
        metadata,
      };
    } catch {
      throw new NotFoundException('找不到网站预览或访问凭证无效');
    }
  }
}
