// lib/security/auth.ts
// Request authentication, identity isolation, and rate-limit enforcement helpers for API routes.

import type { NextRequest } from 'next/server';
import {
  createAuthenticatedUserToken,
  extractTokenFromRequest,
  memoryOwnerKey,
} from '@/lib/memory/identity';
import { checkRateLimit, type RateLimitBucket, type RateLimitResult } from './rate-limiter';
import { hashClientIp, recordSecurityAudit } from './audit-logger';

export interface AuthContext {
  authenticated: boolean;
  identity: string | null;
  ownerKey: string | null;
  isSignedToken: boolean;
  clientIp: string | null;
  subjectKey: string;
}

export function getClientIp(request: Request | NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    null
  );
}

/**
 * Resolves verified request identity strictly from Authorization header, x-jaro-auth-token,
 * or signed `jaro_session` HTTP-only cookie. Never trusts raw unauthenticated userId fields in body.
 */
export function resolveRequestAuth(request: Request | NextRequest): AuthContext {
  const clientIp = getClientIp(request);
  const ipHash = hashClientIp(clientIp) ?? 'unknown_ip';
  const token = extractTokenFromRequest(request);

  if (!token) {
    return {
      authenticated: false,
      identity: null,
      ownerKey: null,
      isSignedToken: false,
      clientIp,
      subjectKey: `ip:${ipHash}`,
    };
  }

  try {
    const ownerKey = memoryOwnerKey(token);
    return {
      authenticated: true,
      identity: token,
      ownerKey,
      isSignedToken: token.startsWith('acc_'),
      clientIp,
      subjectKey: `usr:${ownerKey.slice(0, 24)}:${ipHash.slice(0, 12)}`,
    };
  } catch (error) {
    void recordSecurityAudit({
      eventType: 'access_denied',
      action: 'invalid_token_rejected',
      status: 'denied',
      clientIp,
      metadata: { reason: error instanceof Error ? error.message : 'invalid_token' },
    });
    throw error;
  }
}

export function requireRequestAuth(request: Request | NextRequest): AuthContext & { identity: string; ownerKey: string } {
  const auth = resolveRequestAuth(request);
  if (!auth.authenticated || !auth.identity || !auth.ownerKey) {
    void recordSecurityAudit({
      eventType: 'access_denied',
      action: 'missing_authentication',
      resource: 'url' in request ? request.url : undefined,
      status: 'denied',
      clientIp: auth.clientIp,
    });
    throw new Error('User authentication identity is missing.');
  }
  return auth as AuthContext & { identity: string; ownerKey: string };
}

export function enforceRouteRateLimit(params: {
  request: Request | NextRequest;
  bucket: RateLimitBucket;
  auth?: AuthContext;
  requestId?: string;
}): RateLimitResult {
  const auth = params.auth ?? resolveRequestAuth(params.request);
  const result = checkRateLimit({
    bucket: params.bucket,
    subjectKey: auth.subjectKey,
  });

  if (!result.allowed) {
    void recordSecurityAudit({
      ownerKey: auth.ownerKey,
      eventType: 'rate_limit',
      action: `rate_limit_exceeded:${params.bucket}`,
      status: 'blocked',
      requestId: params.requestId,
      clientIp: auth.clientIp,
      metadata: { retryAfterSec: result.retryAfterSec, limit: result.limit },
    });
  }

  return result;
}

export function issueSignedSessionToken(baseIdentity?: string): {
  token: string;
  ownerKey: string;
} {
  const raw = baseIdentity?.trim() || crypto.randomUUID();
  // If already valid signed token, preserve it
  if (raw.startsWith('acc_')) {
    const ownerKey = memoryOwnerKey(raw);
    return { token: raw, ownerKey };
  }
  const cleanId = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID();
  const token = createAuthenticatedUserToken(cleanId);
  const ownerKey = memoryOwnerKey(token);
  return { token, ownerKey };
}
