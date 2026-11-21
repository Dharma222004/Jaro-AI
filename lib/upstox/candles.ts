import type { CandleValidationSummary, MarketCandle, TechnicalTimeframe, UpstoxInstrument } from '@/types/technical';
import { cachedRequest } from './cache';
import { upstoxGet } from './client';

interface CandleResponse {
  status: string;
  data?: { candles?: Array<[string, number, number, number, number, number, number]> };
}

const TIMEFRAME_MAP: Record<TechnicalTimeframe, { unit: string; interval: number; ttl: number }> = {
  '1m': { unit: 'minutes', interval: 1, ttl: 30_000 },
  '5m': { unit: 'minutes', interval: 5, ttl: 60_000 },
  '15m': { unit: 'minutes', interval: 15, ttl: 2 * 60_000 },
  '30m': { unit: 'minutes', interval: 30, ttl: 3 * 60_000 },
  '1h': { unit: 'hours', interval: 1, ttl: 5 * 60_000 },
  '1d': { unit: 'days', interval: 1, ttl: 30 * 60_000 },
  '1w': { unit: 'weeks', interval: 1, ttl: 4 * 60 * 60_000 },
  '1mo': { unit: 'months', interval: 1, ttl: 12 * 60 * 60_000 },
};

export async function getHistoricalCandles(params: {
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  from: Date;
  to?: Date;
}): Promise<{ candles: MarketCandle[]; validation: CandleValidationSummary; cacheHit: boolean; staleCache: boolean; expiresAt: string }> {
  const to = params.to ?? new Date();
  const config = TIMEFRAME_MAP[params.timeframe];
  const key = `upstox:candles:${params.instrument.instrument_key}:${params.timeframe}:${dateKey(params.from)}:${dateKey(to)}`;
  const result = await cachedRequest(key, config.ttl, async () => {
    const ranges = splitDateRange(params.from, to, params.timeframe);
    const all: MarketCandle[] = [];
    for (const range of ranges) {
      const path = `/v3/historical-candle/${encodeURIComponent(params.instrument.instrument_key)}/${config.unit}/${config.interval}/${dateKey(range.to)}/${dateKey(range.from)}`;
      const response = await upstoxGet<CandleResponse>(path);
      all.push(...parseCandles(response));
    }

    if (isIntraday(params.timeframe) && dateKey(to) === dateKey(new Date())) {
      const intradayPath = `/v3/historical-candle/intraday/${encodeURIComponent(params.instrument.instrument_key)}/${config.unit}/${config.interval}`;
      const intraday = await upstoxGet<CandleResponse>(intradayPath).catch(() => null);
      if (intraday) all.push(...parseCandles(intraday));
    }
    return validateCandles(all, params.timeframe, params.instrument);
  }, { staleIfErrorMs: staleFallbackWindow(params.timeframe) });
  return {
    candles: result.value.candles,
    validation: result.value.summary,
    cacheHit: result.hit,
    staleCache: result.stale,
    expiresAt: result.expiresAt,
  };
}

export function defaultLookback(timeframe: TechnicalTimeframe): Date {
  const days: Record<TechnicalTimeframe, number> = {
    '1m': 7, '5m': 20, '15m': 45, '30m': 90, '1h': 180, '1d': 550, '1w': 5 * 365, '1mo': 12 * 365,
  };
  return new Date(Date.now() - days[timeframe] * 24 * 60 * 60 * 1000);
}

export function isIntraday(timeframe: TechnicalTimeframe) {
  return ['1m', '5m', '15m', '30m', '1h'].includes(timeframe);
}

export function validateCandles(
  input: MarketCandle[],
  timeframe: TechnicalTimeframe,
  instrument?: UpstoxInstrument,
): { candles: MarketCandle[]; summary: CandleValidationSummary } {
  const summary: CandleValidationSummary = {
    received: input.length,
    accepted: 0,
    duplicatesRemoved: 0,
    rejectedInvalidTimestamp: 0,
    rejectedInvalidPrice: 0,
    rejectedInvalidOhlc: 0,
    rejectedInvalidVolume: 0,
    rejectedOutsideSession: 0,
    estimatedMissingIntervals: 0,
    timezoneOffsetsPresent: true,
    newestTimestamp: null,
  };
  const map = new Map<string, MarketCandle>();
  const enforceSession = isIntraday(timeframe) && Boolean(instrument && /^(NSE|BSE)_/.test(instrument.segment));
  const futureToleranceMs = 10 * 60 * 1000;

  for (const candle of input) {
    const timestamp = new Date(candle.timestamp).getTime();
    if (!candle.timestamp || !Number.isFinite(timestamp) || timestamp > Date.now() + futureToleranceMs) {
      summary.rejectedInvalidTimestamp += 1;
      continue;
    }
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(candle.timestamp)) summary.timezoneOffsetsPresent = false;
    if (![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)) {
      summary.rejectedInvalidPrice += 1;
      continue;
    }
    if (candle.high < candle.low || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
      summary.rejectedInvalidOhlc += 1;
      continue;
    }
    if (!Number.isFinite(candle.volume) || candle.volume < 0) {
      summary.rejectedInvalidVolume += 1;
      continue;
    }
    if (enforceSession && !insideIndianTradingSession(candle.timestamp)) {
      summary.rejectedOutsideSession += 1;
      continue;
    }
    if (map.has(candle.timestamp)) summary.duplicatesRemoved += 1;
    map.set(candle.timestamp, candle);
  }

  const candles = [...map.values()].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  summary.accepted = candles.length;
  summary.newestTimestamp = candles.at(-1)?.timestamp ?? null;
  summary.estimatedMissingIntervals = estimateMissingIntervals(candles, timeframe);
  return { candles, summary };
}

function parseCandles(response: CandleResponse): MarketCandle[] {
  return (response.data?.candles ?? []).map((item) => ({
    timestamp: item[0], open: item[1], high: item[2], low: item[3], close: item[4], volume: item[5], openInterest: item[6],
  }));
}

function insideIndianTradingSession(timestamp: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? -1);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? -1);
  const value = hour * 60 + minute;
  // Broad bounds include pre-open and closing-auction candles while rejecting overnight records.
  return value >= 9 * 60 && value <= 16 * 60;
}

function estimateMissingIntervals(candles: MarketCandle[], timeframe: TechnicalTimeframe) {
  const intervalMs: Partial<Record<TechnicalTimeframe, number>> = {
    '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000, '30m': 30 * 60_000, '1h': 60 * 60_000,
  };
  const expected = intervalMs[timeframe];
  if (!expected) return 0;
  let missing = 0;
  for (let index = 1; index < candles.length; index += 1) {
    if (istDate(candles[index - 1].timestamp) !== istDate(candles[index].timestamp)) continue;
    const gap = new Date(candles[index].timestamp).getTime() - new Date(candles[index - 1].timestamp).getTime();
    if (gap > expected * 1.5) missing += Math.max(0, Math.round(gap / expected) - 1);
  }
  return missing;
}

function istDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(timestamp));
}

function splitDateRange(from: Date, to: Date, timeframe: TechnicalTimeframe) {
  const chunkDays = ['1m', '5m', '15m'].includes(timeframe) ? 29
    : ['30m', '1h'].includes(timeframe) ? 89
      : timeframe === '1d' ? 3650 : 50 * 365;
  const ranges: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    const end = new Date(Math.min(to.getTime(), cursor.getTime() + chunkDays * 24 * 60 * 60 * 1000));
    ranges.push({ from: new Date(cursor), to: end });
    cursor = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return ranges;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function staleFallbackWindow(timeframe: TechnicalTimeframe) {
  if (isIntraday(timeframe)) return 6 * 60 * 60_000;
  if (timeframe === '1d') return 3 * 24 * 60 * 60_000;
  if (timeframe === '1w') return 14 * 24 * 60 * 60_000;
  return 30 * 24 * 60 * 60_000;
}
