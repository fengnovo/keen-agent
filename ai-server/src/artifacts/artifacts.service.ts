import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ARTIFACTS_ROOT } from '@keen-agent/ai-agent/config';
import type {
  PublishedArtifact,
  SandboxOutputFile,
} from '@keen-agent/ai-agent/sandbox';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';

const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const ARTIFACT_ID_PATTERN = /^[0-9a-f-]{36}$/i;

/** 元数据是下载 API 的事实来源；即使磁盘文件被修改也要重新校验结构和大小。 */
const artifactMetadataSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(ARTIFACT_ID_PATTERN),
  token: z.string().min(20),
  conversationId: z.string().min(1),
  originalName: z.string().min(1),
  storedName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
});

type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;

const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv; charset=utf-8',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

const safeOriginalName = (value: string): string =>
  basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255) || 'artifact.bin';

const tokenMatches = (provided: string, expected: string): boolean => {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export interface ResolvedArtifact {
  filePath: string;
  metadata: ArtifactMetadata;
}

/**
 * 持久保存沙箱产物，并用不可枚举 UUID + 随机 token 保护下载地址。
 * 发布必须发生在 DockerSandboxBackend.close() 删除会话目录之前。
 */
@Injectable()
export class ArtifactsService {
  private readonly rootDirectory =
    process.env.ARTIFACTS_PATH?.trim() || ARTIFACTS_ROOT;
  private readonly publicBaseUrl = (
    process.env.ARTIFACT_PUBLIC_BASE_URL || '/api/ai-server/artifacts'
  ).replace(/\/$/, '');

  async publish(
    artifact: SandboxOutputFile,
    conversationId: string,
  ): Promise<PublishedArtifact> {
    const sourceInfo = await stat(artifact.absolutePath);
    if (!sourceInfo.isFile()) {
      throw new BadRequestException(`产物不是普通文件：${artifact.name}`);
    }
    if (sourceInfo.size <= 0) {
      throw new BadRequestException(`产物为空：${artifact.name}`);
    }
    if (sourceInfo.size > MAX_ARTIFACT_BYTES) {
      throw new BadRequestException(
        `产物 ${artifact.name} 超过 100 MB，无法发布`,
      );
    }

    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const originalName = safeOriginalName(artifact.name);
    const extension = extname(originalName).toLowerCase();
    const storedName = `artifact${extension || '.bin'}`;
    const artifactDirectory = join(this.rootDirectory, id);
    const destination = join(artifactDirectory, storedName);
    const metadataFile = join(artifactDirectory, 'metadata.json');
    const temporaryMetadataFile = `${metadataFile}.${process.pid}.tmp`;

    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    try {
      // 先复制文件再原子落元数据；任何一步失败都删除未完成的发布目录。
      await copyFile(artifact.absolutePath, destination);
      const content = await readFile(destination);
      const metadata = artifactMetadataSchema.parse({
        version: 1,
        id,
        token,
        conversationId,
        originalName,
        storedName,
        mimeType: MIME_TYPES[extension] || 'application/octet-stream',
        size: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
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
        name: metadata.originalName,
        size: metadata.size,
        mimeType: metadata.mimeType,
        url: `${this.publicBaseUrl}/${id}/download?token=${encodeURIComponent(token)}`,
      };
    } catch (error) {
      await rm(artifactDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async resolve(id: string, token: string): Promise<ResolvedArtifact> {
    if (!ARTIFACT_ID_PATTERN.test(id) || !token) {
      throw new NotFoundException('找不到产物或下载凭证无效');
    }

    try {
      const metadataFile = join(this.rootDirectory, id, 'metadata.json');
      const metadata = artifactMetadataSchema.parse(
        JSON.parse(await readFile(metadataFile, 'utf8')),
      );
      if (metadata.id !== id || !tokenMatches(token, metadata.token)) {
        throw new Error('invalid artifact token');
      }

      // 客户端从不提交真实文件路径，只能用服务端元数据定位固定目录内文件。
      const filePath = join(this.rootDirectory, id, metadata.storedName);
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile() || fileInfo.size !== metadata.size) {
        throw new Error('artifact file changed');
      }

      return { filePath, metadata };
    } catch {
      throw new NotFoundException('找不到产物或下载凭证无效');
    }
  }
}
