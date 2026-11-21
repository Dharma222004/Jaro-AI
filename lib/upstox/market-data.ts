import { cachedRequest } from './cache';
import { upstoxGet } from './client';

export interface UpstoxFullQuote {
  ohlc?: { open: number; high: number; low: number; close: number; volume: number; ts: number };
  timestamp: string;
  instrument_token: string;
  symbol: string;
  last_price: number;
  volume: number;
  average_price: number;
  oi: number;
  net_change: number;
  prev_close_price: number;
  year_high: number;
  year_low: number;
  last_trade_time: string;
}

export async function getFullMarketQuotes(instrumentKeys: string[]) {
  const keys = [...new Set(instrumentKeys)].slice(0, 500);
  if (!keys.length) return { quotes: {} as Record<string, UpstoxFullQuote>, cacheHit: false, expiresAt: new Date().toISOString() };
  const cacheKey = `upstox:quotes:${keys.sort().join(',')}`;
  const result = await cachedRequest(cacheKey, 15_000, async () => {
    const response = await upstoxGet<{ status: string; data: Record<string, UpstoxFullQuote> }>(
      `/v3/market-quote/quotes?instrument_key=${encodeURIComponent(keys.join(','))}`,
      { timeoutMs: 10_000 },
    );
    return response.data ?? {};
  });
  return { quotes: result.value, cacheHit: result.hit, expiresAt: result.expiresAt };
}

export async function getOptionChain(instrumentKey: string, expiry: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) && !['current_week', 'next_week', 'far_week', 'current_month', 'next_month', 'far_month'].includes(expiry)) {
    throw new Error('Invalid option-chain expiry.');
  }
  const key = `upstox:option-chain:${instrumentKey}:${expiry}`;
  const result = await cachedRequest(key, 30_000, async () => upstoxGet<{ status: string; data: unknown[] }>(
    `/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`,
  ));
  return { data: result.value.data ?? [], cacheHit: result.hit, expiresAt: result.expiresAt };
}
