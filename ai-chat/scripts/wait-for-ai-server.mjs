import nextEnv from '@next/env';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { loadEnvConfig } = nextEnv;
const AI_CHAT_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_AI_SERVER_URL = 'http://127.0.0.1:3001';
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

const normalizeBaseUrl = (value) => value.trim().replace(/\/$/, '');

export const getAiServerUrl = (environment = process.env) => {
  if (environment.AI_SERVER_URL?.trim()) {
    return normalizeBaseUrl(environment.AI_SERVER_URL);
  }

  return DEFAULT_AI_SERVER_URL;
};

export const waitForAiServer = async ({
  baseUrl = getAiServerUrl(),
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  pollIntervalMs = 100,
  requestTimeoutMs = 1_000,
} = {}) => {
  const healthUrl = new URL('/api/health', `${normalizeBaseUrl(baseUrl)}/`);
  const deadline = Date.now() + timeoutMs;
  let lastFailure = '服务尚未监听';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const payload = await response.json().catch(() => undefined);

      if (
        response.ok &&
        payload &&
        typeof payload === 'object' &&
        payload.status === 'ok'
      ) {
        return healthUrl.toString();
      }

      lastFailure = `健康检查返回 HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `等待 AI Server 超时（${healthUrl.toString()}）：${lastFailure}`,
  );
};

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  // 与 `next dev` 使用同一套 .env.development.local/.env.local 加载顺序。
  loadEnvConfig(AI_CHAT_DIRECTORY, true);
  const baseUrl = getAiServerUrl();
  console.log(`[dev] 等待 AI Server 就绪：${baseUrl}/api/health`);

  try {
    await waitForAiServer({ baseUrl });
    console.log('[dev] AI Server 已就绪，启动聊天前端。');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
