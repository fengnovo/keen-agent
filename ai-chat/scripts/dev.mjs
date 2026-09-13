import { spawn } from 'node:child_process';

import { getAiServerUrl, waitForAiServer } from './wait-for-ai-server.mjs';

const baseUrl = getAiServerUrl();
console.log(`[dev] 等待 AI Server 就绪：${baseUrl}/api/health`);

try {
  await waitForAiServer({ baseUrl });
  console.log('[dev] AI Server 已就绪，启动聊天前端。');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const child = spawn('next', ['dev', '-p', '3010'], {
  stdio: 'inherit',
  env: process.env,
});

// Ctrl+C 时终端会把 SIGINT/SIGTERM 发给整个进程组，pnpm 也会转发信号。
// 转发给 next 并让它优雅退出；最终以 0 退出，避免 pnpm 把正常停止误报为失败。
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill(signal);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  // 被信号终止（用户主动停止）视为正常退出。
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
