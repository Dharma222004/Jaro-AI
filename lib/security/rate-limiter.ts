// lib/security/rate-limiter.ts
// Sliding-window in-memory rate limiter for per-user and per-IP controls.

export type RateLimitBucket =
  | 'chat_simple'
  | 'chat_research'
  | 'research_pipeline'
  | 'market_api'
  | 'document_upload'
  | 'portfolio_api'
  | 'auth_session';

interface LimitPolicy {
  limit: number;
  windowMs: number;
}

const POLICIES: Record<RateLimitBucket, LimitPolicy> = {
  chat_simple: { limit: 45, windowMs: 60_000 },
  chat_research: { limit: 15, windowMs: 60_000 },
  research_pipeline: { limit: 12, windowMs: 5 * 60_000 },
  market_api: { limit: 60, windowMs: 60_000 },
  document_upload: { limit: 12, windowMs: 10 * 60_000 },
  portfolio_api: { limit: 30, windowMs: 60_000 },
  auth_session: { limit: 25, windowMs: 5 * 60_000 },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: string;
  retryAfterSec: number;
}

const globalStore = globalThis as typeof globalThis & {
  __jaroRateLimitMap?: Map<string, number[]>;
};

const buckets = globalStore.__jaroRateLimitMap ?? new Map<string, number[]>();
if (process.env.NODE_ENV !== 'production') {
  globalStore.__jaroRateLimitMap = buckets;
}

export function checkRateLimit(params: {
  bucket: RateLimitBucket;
  subjectKey: string;
}): RateLimitResult {
  const policy = POLICIES[params.bucket];
  const now = Date.now();
  const windowStart = now - policy.windowMs;
  const fullKey = `${params.bucket}:${params.subjectKey}`;

  // Prune store if map grows large in long-running server processes
  if (buckets.size > 5000) {
    for (const [k, timestamps] of buckets.entries()) {
      const fresh = timestamps.filter((t) => t > windowStart);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }

  const existing = (buckets.get(fullKey) ?? []).filter((ts) => ts > windowStart);
  if (existing.length >= policy.limit) {
    const oldest = existing[0] ?? now;
    const retryAfterMs = Math.max(1000, oldest + policy.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      limit: policy.limit,
      resetAt: new Date(oldest + policy.windowMs).toISOString(),
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  existing.push(now);
  buckets.set(fullKey, existing);

  return {
    allowed: true,
    remaining: Math.max(0, policy.limit - existing.length),
    limit: policy.limit,
    resetAt: new Date(now + policy.windowMs).toISOString(),
    retryAfterSec: 0,
  };
}
