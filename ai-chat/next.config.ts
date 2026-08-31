import type { NextConfig } from 'next';

const aiServerUrl = (process.env.AI_SERVER_URL || 'http://127.0.0.1:3001')
  .trim()
  .replace(/\/$/, '');

const nextConfig: NextConfig = {
  experimental: {
    // 图片以 JSON data URL 通过同源代理发送，需覆盖 6 MB 原图的 Base64 膨胀。
    proxyClientMaxBodySize: '12mb',
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
