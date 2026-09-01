import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';

import { PreviewsService } from './previews.service.js';

// 预览页面是模型生成的不可信前端代码：允许页面自身脚本和样式，但禁止联网、
// 表单提交、对象嵌入和顶层导航；iframe 也不会获得 allow-same-origin。
const PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "worker-src 'none'",
  'sandbox allow-scripts allow-modals',
].join('; ');

@Controller('previews')
export class PreviewsController {
  constructor(private readonly previewsService: PreviewsService) {}

  @Get(':id/:token')
  root(
    @Param('id') id: string,
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.serve(id, token, '', response);
  }

  @Get(':id/:token/*path')
  file(
    @Param('id') id: string,
    @Param('token') token: string,
    @Param('path') path: string | string[],
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.serve(
      id,
      token,
      Array.isArray(path) ? path.join('/') : path,
      response,
    );
  }

  private async serve(
    id: string,
    token: string,
    path: string,
    response: Response,
  ): Promise<StreamableFile> {
    // resolve 同时验证 UUID、token 和站点内部路径，Controller 不直接拼磁盘路径。
    const preview = await this.previewsService.resolve(id, token, path);

    response.setHeader('Cache-Control', 'private, no-store');
    // 页面在不授予 allow-same-origin 的 iframe 中会获得 opaque origin。
    // Vite 为模块脚本添加 crossorigin，因此静态资源必须显式允许匿名 CORS，
    // 否则 HTML 能加载但脚本会被浏览器拦截，最终只显示空白页面。
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Security-Policy', PREVIEW_CSP);
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );

    return new StreamableFile(createReadStream(preview.filePath), {
      type: preview.mimeType,
      length: preview.size,
      disposition: 'inline',
    });
  }
}
