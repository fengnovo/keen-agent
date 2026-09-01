import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';

import { ArtifactsService } from './artifacts.service.js';

const contentDisposition = (fileName: string): string => {
  const asciiFallback = fileName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  return (
    `attachment; filename="${asciiFallback}"; ` +
    `filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
};

@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  /** token 与随机产物 ID 同时校验，响应始终强制下载且禁止中间缓存。 */
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const artifact = await this.artifactsService.resolve(id, token || '');

    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('ETag', `"sha256-${artifact.metadata.sha256}"`);

    return new StreamableFile(createReadStream(artifact.filePath), {
      type: artifact.metadata.mimeType,
      length: artifact.metadata.size,
      disposition: contentDisposition(artifact.metadata.originalName),
    });
  }
}
