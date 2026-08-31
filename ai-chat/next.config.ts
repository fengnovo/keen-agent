import type { NextConfig } from 'next';

const aiServerUrl = (process.env.AI_SERVER_URL || 'http://127.0.0.1:3001')
  .trim()
  .replace(/\/$/, '');

const nextConfig: NextConfig = {
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
