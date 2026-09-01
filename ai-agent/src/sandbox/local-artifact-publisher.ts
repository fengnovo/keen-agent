import { randomUUID } from 'node:crypto';
import { cp, copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CLI_ARTIFACTS_ROOT,
  CLI_PREVIEWS_ROOT,
} from '../config/paths.ts';
import type {
  PublishedArtifact,
  PublishedPreview,
  SandboxOutputFile,
  SandboxPreviewDirectory,
} from './types.ts';

/**
 * CLI 没有 Nest 下载 API，因此先复制出即将删除的会话目录，再返回 file URL。
 * 复制目标使用随机目录，避免同名产物互相覆盖。
 */
export const publishLocalArtifact = async (
  artifact: SandboxOutputFile,
): Promise<PublishedArtifact> => {
  const safeName = basename(artifact.name)
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .slice(0, 200) || 'artifact.bin';
  const artifactDirectory = join(CLI_ARTIFACTS_ROOT, randomUUID());
  const destination = join(artifactDirectory, safeName);

  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await copyFile(artifact.absolutePath, destination);
  return {
    name: safeName,
    size: artifact.size,
    url: pathToFileURL(destination).href,
  };
};

/**
 * CLI 静态网站同样先持久复制；与 Web 端不同，它不提供 CSP 隔离层，
 * 因而只应打开自己信任的本地生成内容。
 */
export const publishLocalPreview = async (
  preview: SandboxPreviewDirectory,
): Promise<PublishedPreview> => {
  const safeName = basename(preview.name)
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 80) || 'website';
  const previewDirectory = join(CLI_PREVIEWS_ROOT, randomUUID());
  const destination = join(previewDirectory, safeName);

  await mkdir(previewDirectory, { recursive: true, mode: 0o700 });
  await cp(preview.absolutePath, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  return {
    name: safeName,
    fileCount: preview.fileCount,
    size: preview.size,
    url: pathToFileURL(join(destination, 'index.html')).href,
  };
};
