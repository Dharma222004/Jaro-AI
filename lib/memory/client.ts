'use client';

const IDENTITY_KEY = 'jaro_memory_identity_v1';
const ENABLED_KEY = 'jaro_memory_enabled_v1';

export function getMemoryIdentity() {
  let identity = localStorage.getItem(IDENTITY_KEY);
  if (!identity) {
    identity = crypto.randomUUID();
    localStorage.setItem(IDENTITY_KEY, identity);
  }
  return identity;
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
