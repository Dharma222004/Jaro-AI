interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

const values = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options: { staleIfErrorMs?: number } = {},
): Promise<{ value: T; hit: boolean; stale: boolean; expiresAt: string }> {
  const now = Date.now();
  const cached = values.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    return { value: cached.value, hit: true, stale: false, expiresAt: new Date(cached.expiresAt).toISOString() };
  }

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    const value = await existing;
    const entry = values.get(key) as CacheEntry<T> | undefined;
    return { value, hit: true, stale: false, expiresAt: new Date(entry?.expiresAt ?? now + ttlMs).toISOString() };
  }

  const promise = fetcher();
  inFlight.set(key, promise);
  try {
    const value = await promise;
    const expiresAt = Date.now() + ttlMs;
    values.set(key, { value, expiresAt, staleUntil: expiresAt + (options.staleIfErrorMs ?? 0) });
    prune();
    return { value, hit: false, stale: false, expiresAt: new Date(expiresAt).toISOString() };
  } catch (error) {
    if (cached && options.staleIfErrorMs && cached.staleUntil > Date.now()) {
      return { value: cached.value, hit: true, stale: true, expiresAt: new Date(cached.expiresAt).toISOString() };
    }
    throw error;
  } finally {
    inFlight.delete(key);
  }
}

function prune() {
  if (values.size <= 150) return;
  const now = Date.now();
  for (const [key, entry] of values) {
    if ((entry.staleUntil ?? entry.expiresAt) <= now) values.delete(key);
  }
  if (values.size <= 150) return;
  for (const key of [...values.keys()].slice(0, values.size - 150)) values.delete(key);
}
