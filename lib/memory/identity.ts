import { createHash } from 'node:crypto';

export function memoryOwnerKey(secret: string) {
  const normalized = secret.trim();
  if (normalized.length < 20 || normalized.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error('A valid private memory identity is required.');
  }
  return createHash('sha256').update(`jaro-memory-v1:${normalized}`).digest('hex');
}

export function memoryIdentityFromRequest(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Memory identity is missing.');
  return match[1];
}
