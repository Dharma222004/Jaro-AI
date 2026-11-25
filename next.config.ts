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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  // ── Vercel / Serverless compatibility ──────────────────────────────────────
  // These packages use native binaries and must NOT be bundled by webpack.
  serverExternalPackages: ['@prisma/client', '.prisma/client', 'yahoo-finance2'],

  // Ensure prisma files are included in the serverless output tracing bundle
  outputFileTracingIncludes: {
    '/**': ['./prisma/**'],
  },

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
