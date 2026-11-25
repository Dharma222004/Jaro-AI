'use client';

const IDENTITY_KEY = 'jaro_memory_identity_v1';
const ENABLED_KEY = 'jaro_memory_enabled_v1';

let sessionUpgradePromise: Promise<string> | null = null;

export function getMemoryIdentity() {
  let identity = localStorage.getItem(IDENTITY_KEY);
  if (!identity) {
    identity = crypto.randomUUID();
    localStorage.setItem(IDENTITY_KEY, identity);
  }
  return identity;
}

/**
 * Ensures the browser holds an HMAC-signed session token (`acc_<id>.<sig>`)
 * and HTTP-only cookie from `/api/auth/session` without losing prior UUID history when upgrading.
 */
export async function ensureSignedSession(): Promise<string> {
  if (typeof window === 'undefined') return '';
  const current = getMemoryIdentity();
  if (current.startsWith('acc_') && current.includes('.')) {
    return current;
  }
  if (!sessionUpgradePromise) {
    sessionUpgradePromise = fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legacyIdentity: current }),
    })
      .then(async (res) => {
        if (!res.ok) return current;
        const data = (await res.json().catch(() => null)) as { token?: string } | null;
        if (data?.token) {
          localStorage.setItem(IDENTITY_KEY, data.token);
          return data.token;
        }
        return current;
      })
      .catch(() => current)
      .finally(() => {
        sessionUpgradePromise = null;
      });
  }
  return sessionUpgradePromise;
}

export function getMemoryEnabled() {
  return localStorage.getItem(ENABLED_KEY) !== 'false';
}

export function setMemoryEnabled(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('jaro-memory-setting', { detail: enabled }));
}

export function memoryAuthorization(identity = getMemoryIdentity()) {
  return { Authorization: `Bearer ${identity}` };
}
