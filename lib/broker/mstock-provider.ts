import type {
  BrokerCandle,
  BrokerProviderName,
  BrokerQuote,
  MarketDataProvider,
  ProviderHealth,
} from './types';
import { lookupCanonicalInstrument } from './instrument-registry';

const MSTOCK_BASE_URL = process.env.MSTOCK_BASE_URL || 'https://api.mstock.trade/openapi/typea';

export class MStockProvider implements MarketDataProvider {
  readonly name: BrokerProviderName = 'mstock';

  private resolveKey(): string | null {
    const raw = process.env.MSTOCK_API_KEY || process.env.MSTOCK_TYPE_B_KEY;
    if (!raw) return null;
    return raw.trim().replace(/^['"]|['"]$/g, '');
  }

  async checkHealth(): Promise<ProviderHealth> {
    const key = this.resolveKey();
    if (!key) {
      return {
        provider: 'mstock',
        available: false,
        lastCheckedAt: new Date().toISOString(),
        error: 'm.Stock credentials not configured.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${MSTOCK_BASE_URL}/instruments/quote/ltp?instruments=NSE:2885`, {
        headers: {
          'x-api-key': key,
          'X-Mirae-Version': '1',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      return {
        provider: 'mstock',
        available: res.status < 500, // Reachable
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: res.ok ? undefined : `Status ${res.status}`,
      };
    } catch (err: unknown) {
      return {
        provider: 'mstock',
        available: false,
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  async getQuote(symbol: string, exchange: 'NSE' | 'BSE' = 'NSE'): Promise<BrokerQuote | null> {
    const key = this.resolveKey();
    if (!key) return null;

    const canonical = lookupCanonicalInstrument(symbol);
    const token = canonical?.mstockToken;
    if (!token) return null;

    try {
      const res = await fetch(`${MSTOCK_BASE_URL}/instruments/quote/ltp?instruments=${exchange}:${token}`, {
        headers: {
          'x-api-key': key,
          'X-Mirae-Version': '1',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      const quoteKey = `${exchange}:${token}`;
      const item = data.data?.[quoteKey];
      if (!item) return null;

      const lastPrice = Number(item.last_price ?? 0);
      return {
        symbol: symbol.toUpperCase(),
        exchange,
        lastPrice,
        previousClose: lastPrice,
        change: 0,
        changePercent: 0,
        open: lastPrice,
        high: lastPrice,
        low: lastPrice,
        volume: 0,
        timestamp: new Date().toISOString(),
        provider: 'mstock',
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
  }): Promise<BrokerCandle[]> {
    const key = this.resolveKey();
    if (!key) return [];

    const exchange = params.exchange ?? 'NSE';
    const canonical = lookupCanonicalInstrument(params.symbol);
    const token = canonical?.mstockToken;
    if (!token) return [];

    const intervalMap: Record<string, string> = {
      '1m': 'minute',
      '5m': '5minute',
      '15m': '15minute',
      '30m': '30minute',
      '1h': '60minute',
      '1d': 'day',
      '1w': 'day',
      '1mo': 'day',
    };

    const interval = intervalMap[params.timeframe] || 'day';
    const toDate = params.to ?? new Date();
    const fromStr = params.from.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];

    const url = `${MSTOCK_BASE_URL}/instruments/historical/${exchange}/${token}/${interval}?from=${fromStr}&to=${toStr}`;

    try {
      const res = await fetch(url, {
        headers: {
          'x-api-key': key,
          'X-Mirae-Version': '1',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];
      const json = await res.json();
      const candles = json.data?.candles;
      if (!Array.isArray(candles)) return [];

      return candles
        .map((c: unknown[]) => ({
          timestamp: String(c[0]),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5]),
        }))
        .filter((c: BrokerCandle) => Number.isFinite(c.close) && c.close > 0);
    } catch {
      return [];
    }
  }
}
