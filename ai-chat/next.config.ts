import type { NextConfig } from 'next';

const aiServerUrl = (process.env.AI_SERVER_URL || 'http://127.0.0.1:3001')
  .trim()
  .replace(/\/$/, '');

const nextConfig: NextConfig = {
  experimental: {
    // 图片以 JSON data URL 通过同源代理发送，需覆盖 6 MB 原图的 Base64 膨胀。
    proxyClientMaxBodySize: '12mb',
    // Next dev 重写代理默认 30s 空闲超时，会在 Agent 等待 MCP 工具/模型期间
    // 掐断静默的 SSE 连接，导致页面随机出现“请求失败”。与前端 310s 流式超时对齐。
    proxyTimeout: 310_000,
  },
  async rewrites() {
    return [
      {
        source: '/api/ai-server/:path*',
        destination: `${aiServerUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
