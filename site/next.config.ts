import type { NextConfig } from 'next';

const nextConfig: NextConfig =
  process.env.LOTTO_DEPLOY_TARGET === 'vercel' || process.env.VERCEL === '1'
    ? { output: 'export' }
    : {};

export default nextConfig;
