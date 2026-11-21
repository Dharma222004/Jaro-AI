import crypto from 'node:crypto';
import type {
  BrokerCandle,
  BrokerProviderName,
  BrokerQuote,
  MarketDataProvider,
  ProviderHealth,
} from './types';
import { lookupCanonicalInstrument } from './instrument-registry';

const ANGEL_ROOT_URL = process.env.ANGEL_ROOT_URL || 'https://apiconnect.angelone.in';

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (let i = 0; i < base32.length; i++) {
    const char = base32[i].toUpperCase();
    if (char === '=') break;
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTOTP(secret: string): string {
  const clean = secret.trim().replace(/\s+/g, '');
  const key = base32Decode(clean);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

export class AngelOneProvider implements MarketDataProvider {
  readonly name: BrokerProviderName = 'angelone';
  private sessionToken: string | null = null;
  private sessionExpiresAt = 0;

  private async getSession(): Promise<string | null> {
    if (this.sessionToken && Date.now() < this.sessionExpiresAt) {
      return this.sessionToken;
    }

    const apiKey = process.env.ANGEL_API_KEY;
    const clientId = process.env.ANGEL_CLIENT_ID;
    const pin = process.env.ANGEL_PIN;
    const secret = process.env.ANGEL_TOTP_SECRET;

    if (!apiKey || !clientId || !pin || !secret) return null;

    try {
      const totp = generateTOTP(secret);
      const res = await fetch(`${ANGEL_ROOT_URL}/rest/secure/angelbroking/user/v1/loginByPassword`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '192.168.1.5',
          'X-ClientPublicIP': '106.193.147.98',
          'X-MACAddress': 'fe80::1',
          'X-PrivateKey': apiKey,
        },
        body: JSON.stringify({
          clientcode: clientId,
          password: pin,
          totp,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      const data = JSON.parse(text);
      if (data.status && data.data?.jwtToken) {
        this.sessionToken = data.data.jwtToken;
        // Session valid for ~6 hours
        this.sessionExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
        return this.sessionToken;
      }
      return null;
    } catch {
      return null;
    }
  }

  async checkHealth(): Promise<ProviderHealth> {
    const apiKey = process.env.ANGEL_API_KEY;
    if (!apiKey) {
      return {
        provider: 'angelone',
        available: false,
        lastCheckedAt: new Date().toISOString(),
        error: 'Angel One credentials not configured.',
      };
    }

    const start = Date.now();
    try {
      const token = await this.getSession();
      return {
        provider: 'angelone',
        available: Boolean(token),
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: token ? undefined : 'Authentication session rejected',
      };
    } catch (err: unknown) {
      return {
        provider: 'angelone',
        available: false,
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  async getQuote(symbol: string, exchange: 'NSE' | 'BSE' = 'NSE'): Promise<BrokerQuote | null> {
    const token = await this.getSession();
    const apiKey = process.env.ANGEL_API_KEY;
    if (!token || !apiKey) return null;

    const canonical = lookupCanonicalInstrument(symbol);
    const symbolToken = canonical?.angelToken;
    if (!symbolToken) return null;

    try {
      const res = await fetch(`${ANGEL_ROOT_URL}/rest/secure/angelbroking/market/v1/quote/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '192.168.1.5',
          'X-ClientPublicIP': '106.193.147.98',
          'X-MACAddress': 'fe80::1',
          'X-PrivateKey': apiKey,
        },
        body: JSON.stringify({
          mode: 'FULL',
          exchangeTokens: {
            [exchange]: [symbolToken],
          },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;
      const json = await res.json();
      const item = json.data?.fetched?.[0];
      if (!item) return null;

      const lastPrice = Number(item.ltp ?? 0);
      const close = Number(item.close ?? lastPrice);
      const change = lastPrice - close;
      const changePercent = close > 0 ? (change / close) * 100 : 0;

      return {
        symbol: symbol.toUpperCase(),
        exchange,
        lastPrice,
        previousClose: close,
        change,
        changePercent,
        open: Number(item.open ?? lastPrice),
        high: Number(item.high ?? lastPrice),
        low: Number(item.low ?? lastPrice),
        volume: Number(item.tradeVolume ?? item.volume ?? 0),
        yearHigh: item.high52 != null ? Number(item.high52) : undefined,
        yearLow: item.low52 != null ? Number(item.low52) : undefined,
        timestamp: new Date().toISOString(),
        provider: 'angelone',
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
    const token = await this.getSession();
    const apiKey = process.env.ANGEL_API_KEY;
    if (!token || !apiKey) return [];

    const exchange = params.exchange ?? 'NSE';
    const canonical = lookupCanonicalInstrument(params.symbol);
    const symbolToken = canonical?.angelToken;
    if (!symbolToken) return [];

    const intervalMap: Record<string, string> = {
      '1m': 'ONE_MINUTE',
      '5m': 'FIVE_MINUTE',
      '15m': 'FIFTEEN_MINUTE',
      '30m': 'THIRTY_MINUTE',
      '1h': 'ONE_HOUR',
      '1d': 'ONE_DAY',
      '1w': 'ONE_DAY', // aggregated
      '1mo': 'ONE_DAY', // aggregated
    };

    const interval = intervalMap[params.timeframe] || 'ONE_DAY';
    const toDate = params.to ?? new Date();

    const formatDate = (d: Date) => {
      const YYYY = d.getFullYear();
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const DD = String(d.getDate()).padStart(2, '0');
      const HH = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${YYYY}-${MM}-${DD} ${HH}:${mm}`;
    };

    try {
      const res = await fetch(`${ANGEL_ROOT_URL}/rest/secure/angelbroking/historical/v1/getCandleData`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '192.168.1.5',
          'X-ClientPublicIP': '106.193.147.98',
          'X-MACAddress': 'fe80::1',
          'X-PrivateKey': apiKey,
        },
        body: JSON.stringify({
          exchange,
          symboltoken: symbolToken,
          interval,
          fromdate: formatDate(params.from),
          todate: formatDate(toDate),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];
      const json = await res.json();
      const data = json.data;
      if (!Array.isArray(data)) return [];

      // Angel candle format: [timestamp, open, high, low, close, volume]
      return data
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
