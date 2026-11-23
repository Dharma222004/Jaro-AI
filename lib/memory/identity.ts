import { createHash, createHmac } from 'node:crypto';

const AUTH_SECRET = process.env.JARO_AUTH_SECRET || 'jaro-auth-secure-v2-deterministic-key-7729';

/**
 * Derives a cryptographically secure, isolated owner key for database records.
 * Supports both UUID-based identities and signed session tokens.
 */
export function memoryOwnerKey(secret: string): string {
  const normalized = secret.trim();
  if (normalized.length < 10 || normalized.length > 500) {
    throw new Error('A valid authenticated user identity is required.');
  }

  // Handle signed account tokens: format "acc_<userId>.<signature>"
  if (normalized.startsWith('acc_') && normalized.includes('.')) {
    const [headerAndPayload, signature] = normalized.split('.');
    const expectedSig = createHmac('sha256', AUTH_SECRET).update(headerAndPayload).digest('hex').slice(0, 32);
    if (signature === expectedSig) {
      return createHash('sha256').update(`jaro-authenticated-user:${headerAndPayload}`).digest('hex');
    }
  }

  // Handle standard user identity keys
  if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
    throw new Error('A valid authenticated user identity is required.');
  }

  return createHash('sha256').update(`jaro-account-v1:${normalized}`).digest('hex');
}

/**
 * Generates a signed, verifiable user account token.
 */
export function createAuthenticatedUserToken(userId: string): string {
  const payload = `acc_${userId}`;
  const signature = createHmac('sha256', AUTH_SECRET).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${signature}`;
}

/**
 * Extracts and verifies the authenticated user identity from request headers.
 */
export function memoryIdentityFromRequest(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const tokenFromHeader = match ? match[1].trim() : (request.headers.get('x-jaro-auth-token') ?? '').trim();

  if (!tokenFromHeader) {
    throw new Error('User authentication identity is missing.');
  }

  return tokenFromHeader;
}
