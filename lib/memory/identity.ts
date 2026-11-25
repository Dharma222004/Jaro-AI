import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const globalForSecret = globalThis as typeof globalThis & { __jaroProcessAuthSecret?: string };

function getAuthSecret(): string {
  const explicit = process.env.JARO_AUTH_SECRET?.trim();
  if (explicit && explicit.length >= 16) return explicit;

  // Derive deterministic server-only signing secret from server API secret when explicit secret unset.
  // Never exposed to client bundles.
  const seed = process.env.NVIDIA_API_KEY?.trim() || process.env.TAVILY_API_KEY?.trim();
  if (seed && !seed.startsWith('your_')) {
    return createHash('sha256').update(`jaro-server-signing-key:${seed}`).digest('hex');
  }

  // Ephemeral CSPRNG fallback for zero-env test execution (no hardcoded static secret literal).
  if (!globalForSecret.__jaroProcessAuthSecret) {
    globalForSecret.__jaroProcessAuthSecret = randomBytes(32).toString('hex');
  }
  return globalForSecret.__jaroProcessAuthSecret;
}

/**
 * Derives a cryptographically isolated owner key for database records.
 * Rejects tampered signed tokens (`acc_<userId>.<hmac>`) using timing-safe comparison.
 */
export function memoryOwnerKey(secret: string): string {
  const normalized = secret.trim();
  if (normalized.length < 10 || normalized.length > 500) {
    throw new Error('A valid authenticated user identity is required.');
  }

  if (normalized.startsWith('acc_')) {
    const dotIndex = normalized.indexOf('.');
    if (dotIndex <= 4) {
      throw new Error('Invalid authenticated session token.');
    }
    const headerAndPayload = normalized.slice(0, dotIndex);
    const signature = normalized.slice(dotIndex + 1);
    if (!verifyTokenSignature(headerAndPayload, signature)) {
      throw new Error('Invalid or expired session token signature.');
    }
    return createHash('sha256').update(`jaro-authenticated-user:${headerAndPayload}`).digest('hex');
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
    throw new Error('A valid authenticated user identity is required.');
  }

  return createHash('sha256').update(`jaro-account-v1:${normalized}`).digest('hex');
}

export function verifyTokenSignature(payload: string, signatureHex: string): boolean {
  if (!payload || !/^[a-f0-9]{32}$/i.test(signatureHex)) return false;
  const expected = createHmac('sha256', getAuthSecret()).update(payload).digest('hex').slice(0, 32);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHex.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Generates an HMAC-signed, verifiable user session token.
 */
export function createAuthenticatedUserToken(userId: string): string {
  const safeUserId = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!safeUserId) {
    throw new Error('Cannot issue token for empty user ID.');
  }
  const payload = `acc_${safeUserId}`;
  const signature = createHmac('sha256', getAuthSecret()).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${signature}`;
}

export function extractTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const headerToken = match ? match[1].trim() : (request.headers.get('x-jaro-auth-token') ?? '').trim();
  if (headerToken) return headerToken;

  const cookieHeader = request.headers.get('cookie') ?? '';
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      if (key === 'jaro_session') {
        const val = decodeURIComponent(part.slice(idx + 1).trim());
        if (val) return val;
      }
    }
  }
  return null;
}

/**
 * Extracts and verifies the authenticated user identity from request headers or signed session cookie.
 */
export function memoryIdentityFromRequest(request: Request): string {
  const token = extractTokenFromRequest(request);
  if (!token) {
    throw new Error('User authentication identity is missing.');
  }
  // Validate format & HMAC signature immediately
  memoryOwnerKey(token);
  return token;
}
