import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ── Vercel / Serverless compatibility ──────────────────────────────────────
  // These packages use native binaries and must NOT be bundled by webpack.
  serverExternalPackages: ['@prisma/client', '.prisma/client', 'yahoo-finance2'],

  // ── Image optimization ──────────────────────────────────────────────────────
  images: {
    // Allow the app's own domain (populated at runtime by Vercel)
    remotePatterns: [],
    // Local images (e.g. /logo.png from public/) work without configuration
    unoptimized: false,
  },

  // ── Security headers ────────────────────────────────────────────────────────
  poweredByHeader: false,

  // ── Build output ────────────────────────────────────────────────────────────
  // 'standalone' bundles only what Vercel needs — smaller cold starts
  output: 'standalone',

  // ── ESLint / TypeScript during build ────────────────────────────────────────
  // Vercel will fail the build on lint errors — we rely on tsc instead.
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
