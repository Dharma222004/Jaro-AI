import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Resolves a safe, writable SQLite database path for local dev, standalone builds, and Vercel serverless functions.
 * In AWS Lambda / Vercel serverless environments, only `/tmp` is writable.
 */
function resolveDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL?.trim();

  // If remote database (PostgreSQL / Supabase / Neon / MySQL), return as is
  if (envUrl && (envUrl.startsWith('postgresql://') || envUrl.startsWith('postgres://') || envUrl.startsWith('mysql://'))) {
    return envUrl;
  }

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

  if (isServerless) {
    const tmpDbPath = path.join('/tmp', 'dev.db');
    if (!fs.existsSync(/*turbopackIgnore: true*/ tmpDbPath)) {
      const candidatePaths = [
        path.join(process.cwd(), 'prisma', 'dev.db'),
        path.join(process.cwd(), '.next', 'server', 'prisma', 'dev.db'),
      ];

      let copied = false;
      for (const src of candidatePaths) {
        try {
          if (fs.existsSync(/*turbopackIgnore: true*/ src)) {
            fs.copyFileSync(src, tmpDbPath);
            copied = true;
            break;
          }
        } catch {
          // continue search
        }
      }

      if (!copied) {
        try {
          fs.writeFileSync(tmpDbPath, '');
        } catch {
          // ignore
        }
      }
    }
    return `file:${tmpDbPath}`;
  }

  // Local development / standalone server: statically scoped to prisma subfolder
  const localDbPath = path.join(process.cwd(), 'prisma', 'dev.db');
  return `file:${localDbPath}`;
}

const resolvedUrl = resolveDatabaseUrl();

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: resolvedUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

const prismaInstance = global.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prismaInstance;
}

export { prismaInstance as prisma, resolveDatabaseUrl };
