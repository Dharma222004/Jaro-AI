import type {
  BrokerCandle,
  BrokerProviderName,
  BrokerQuote,
  MarketDataProvider,
  ProviderHealth,
} from './types';
import { lookupCanonicalInstrument } from './instrument-registry';
import { resolveUpstoxInstrument } from '@/lib/upstox/instruments';

const UPSTOX_BASE_URL = 'https://api.upstox.com';

export class UpstoxProvider implements MarketDataProvider {
  readonly name: BrokerProviderName = 'upstox';

  private resolveToken(): string | null {
    const raw = process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_ANALYTICS_TOKEN;
    if (!raw) return null;
    const token = raw.trim().replace(/^['"]|['"]$/g, '');
    return token || null;
  }

  async checkHealth(): Promise<ProviderHealth> {
    const token = this.resolveToken();
    if (!token) {
      return {
        provider: 'upstox',
        available: false,
        lastCheckedAt: new Date().toISOString(),
        error: 'Upstox credentials not configured.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${UPSTOX_BASE_URL}/v2/market-quote/quotes?instrument_key=NSE_EQ|INE154A01025`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      return {
        provider: 'upstox',
        available: res.ok,
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: res.ok ? undefined : `Status ${res.status}`,
      };
    } catch (err: unknown) {
      return {
        provider: 'upstox',
        available: false,
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  async getQuote(symbol: string, exchange: 'NSE' | 'BSE' = 'NSE', isin?: string): Promise<BrokerQuote | null> {
    const token = this.resolveToken();
    if (!token) return null;

    let instrumentKey: string | null = null;
    const canonical = lookupCanonicalInstrument(symbol);
    if (canonical) {
      instrumentKey = canonical.upstoxKey;
    } else {
      const resolved = await resolveUpstoxInstrument(symbol, exchange, isin).catch(() => null);
      instrumentKey = resolved?.instrument?.instrument_key ?? null;
    }

    if (!instrumentKey) return null;

    try {
      const res = await fetch(`${UPSTOX_BASE_URL}/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKey)}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      const quoteData = data.data ? Object.values(data.data)[0] as Record<string, unknown> | undefined : undefined;
      if (!quoteData) return null;

      const lastPrice = Number(quoteData.last_price ?? 0);
      const prevClose = Number(quoteData.prev_close_price ?? lastPrice);
      const change = Number(quoteData.net_change ?? (lastPrice - prevClose));
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const ohlc = (quoteData.ohlc ?? {}) as Record<string, unknown>;

      return {
        symbol: symbol.toUpperCase(),
        exchange,
        lastPrice,
        previousClose: prevClose,
        change,
        changePercent,
        open: Number(ohlc.open ?? lastPrice),
        high: Number(ohlc.high ?? lastPrice),
        low: Number(ohlc.low ?? lastPrice),
        volume: Number(quoteData.volume ?? 0),
        yearHigh: quoteData.year_high != null ? Number(quoteData.year_high) : undefined,
        yearLow: quoteData.year_low != null ? Number(quoteData.year_low) : undefined,
        timestamp: typeof quoteData.timestamp === 'string' ? quoteData.timestamp : new Date().toISOString(),
        provider: 'upstox',
      };
    } catch {
      return null;
    }
  }

  async getHistoricalCandles(params: {
    symbol: string;
    exchange?: 'NSE' | 'BSE';
    timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1mo';
    from: Date;
    to?: Date;
    isin?: string;
  }): Promise<BrokerCandle[]> {
    const token = this.resolveToken();
    if (!token) return [];

    const exchange = params.exchange ?? 'NSE';
    let instrumentKey: string | null = null;
    const canonical = lookupCanonicalInstrument(params.symbol);
    if (canonical) {
      instrumentKey = canonical.upstoxKey;
    } else {
      const resolved = await resolveUpstoxInstrument(params.symbol, exchange, params.isin).catch(() => null);
      instrumentKey = resolved?.instrument?.instrument_key ?? null;
    }

    if (!instrumentKey) return [];

    const interval = this.mapInterval(params.timeframe);
    const toDate = params.to ?? new Date();
    const toStr = toDate.toISOString().split('T')[0];
    const fromStr = params.from.toISOString().split('T')[0];

    const url = `${UPSTOX_BASE_URL}/v2/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${toStr}/${fromStr}`;

    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];
      const json = await res.json();
      const rawCandles = Array.isArray(json.data?.candles) ? json.data.candles : [];

      // Upstox candle format: [timestamp, open, high, low, close, volume, open_interest]
      return rawCandles
        .map((c: unknown[]) => ({
          timestamp: String(c[0]),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5]),
          openInterest: c[6] != null ? Number(c[6]) : undefined,
        }))
        .filter((c: BrokerCandle) => Number.isFinite(c.close) && c.close > 0)
        .reverse(); // Return ascending chronological order
    } catch {
      return [];
    }
  }

  private mapInterval(timeframe: string): string {
    switch (timeframe) {
      case '1m': return '1minute';
      case '5m':
      case '15m':
      case '30m': return '30minute';
      case '1h': return '60minute';
      case '1d': return 'day';
      case '1w': return 'week';
      case '1mo': return 'month';
      default: return 'day';
    }
  }
}
