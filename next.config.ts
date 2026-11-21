import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/',
        permanent: true,
      },
    ];
  },
  // ── Vercel / Serverless compatibility ──────────────────────────────────────
  // These packages use native binaries and must NOT be bundled by webpack.
  serverExternalPackages: ['@prisma/client', '.prisma/client', 'yahoo-finance2'],

  // ── Image optimization ──────────────────────────────────────────────────────
  images: {
    remotePatterns: [],
    unoptimized: false,
  },

  // ── Security headers ────────────────────────────────────────────────────────
  poweredByHeader: false,

  // ── Build output ────────────────────────────────────────────────────────────
  // 'standalone' bundles only what Vercel needs — smaller cold starts
  output: 'standalone',
};

export default nextConfig;
