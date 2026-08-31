import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import { AppModule } from './app.module.js';

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
});

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`AI_SERVER_PORT 不是有效端口：${value}`);
  }

  return port;
};

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  const port = parsePort(process.env.AI_SERVER_PORT);
  const host = process.env.AI_SERVER_HOST?.trim() || '127.0.0.1';
  const allowedOrigins = (
    process.env.AI_CHAT_ORIGIN ??
    'http://localhost:3000,http://127.0.0.1:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  });

  await app.listen(port, host);
  Logger.log(`AI Server 已启动：http://${host}:${port}/api`, 'Bootstrap');
};

await bootstrap();
