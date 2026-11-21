import type { UpstoxInstrument } from '@/types/technical';
import { cachedRequest } from './cache';
import { gunzipSync } from 'node:zlib';

const INSTRUMENT_URLS = [
  'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz',
  'https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz',
];

export async function getInstrumentMaster(): Promise<UpstoxInstrument[]> {
  try {
    const result = await cachedRequest('upstox:instrument-master', 22 * 60 * 60 * 1000, async () => {
      const responses = await Promise.all(INSTRUMENT_URLS.map(async (url) => {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Instrument master download failed (${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const jsonBytes = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
        return JSON.parse(new TextDecoder().decode(jsonBytes)) as UpstoxInstrument[];
      }));
      return responses.flat().filter(isSupportedCashInstrument);
    });
    return result.value || [];
  } catch {
    return [];
  }
}

export async function resolveUpstoxInstrument(
  query: string,
  preferredExchange?: 'NSE' | 'BSE',
  isin?: string,
): Promise<{ instrument: UpstoxInstrument | null; candidates: UpstoxInstrument[] }> {
  try {
    const instruments = await getInstrumentMaster();
    if (!instruments.length) {
      return { instrument: null, candidates: [] };
    }
    if (isin) {
      const byIsin = instruments.filter((item) => item.isin === isin);
      const preferred = prefer(byIsin, preferredExchange);
      if (preferred) return { instrument: preferred, candidates: byIsin.slice(0, 8) };
    }

    const normalized = normalizeQuery(query);
    const exactSymbol = instruments.filter((item) => normalize(item.trading_symbol) === normalized);
    const exactName = instruments.filter((item) => normalize(item.name) === normalized || normalize(item.short_name ?? '') === normalized);
    const exact = exactSymbol.length ? exactSymbol : exactName;
    if (exact.length) return { instrument: prefer(exact, preferredExchange), candidates: exact.slice(0, 8) };

    const partial = instruments.filter((item) => {
      const symbol = normalize(item.trading_symbol);
      const name = normalize(item.name);
      return name.includes(normalized) || normalized.includes(name) || symbol.includes(normalized);
    }).sort((a, b) => score(b, normalized, preferredExchange) - score(a, normalized, preferredExchange));

    const best = partial[0];
    const second = partial[1];
    const bestScore = best ? score(best, normalized, preferredExchange) : 0;
    const secondScore = second ? score(second, normalized, preferredExchange) : 0;
    // Return best if: score gap >= 5, OR best has exact symbol match (score >= 100), OR only one candidate
    const unambiguous = best && (!second || bestScore >= 100 || bestScore - secondScore >= 5);
    return { instrument: unambiguous ? best : null, candidates: partial.slice(0, 8) };
  } catch {
    return { instrument: null, candidates: [] };
  }
}

function isSupportedCashInstrument(item: UpstoxInstrument) {
  return (item.segment === 'NSE_EQ' && item.instrument_type === 'EQ')
    || item.segment === 'NSE_INDEX'
    || (item.segment === 'BSE_EQ' && ['A', 'B', 'X', 'T', 'EQ'].includes(item.instrument_type))
    || item.segment === 'BSE_INDEX';
}

function prefer(items: UpstoxInstrument[], exchange?: 'NSE' | 'BSE'): UpstoxInstrument | null {
  if (!items.length) return null;
  if (exchange) return items.find((item) => item.exchange === exchange) ?? items[0];
  return items.find((item) => item.exchange === 'NSE') ?? items[0];
}

function normalize(value: string) {
  return value.toUpperCase().replace(/\b(LIMITED|LTD|THE)\b/g, '').replace(/[^A-Z0-9]/g, '');
}

function normalizeQuery(value: string) {
  const normalized = normalize(value);
  const aliases: Record<string, string> = {
    NIFTY: 'NIFTY50',
    BANKNIFTY: 'NIFTYBANK',
    NIFTYNEXT: 'NIFTYNEXT50',
    SENSEX: 'SENSEX',
    INDIAVIX: 'INDIAVIX',
  };
  return aliases[normalized] ?? normalized;
}

function score(item: UpstoxInstrument, query: string, exchange?: 'NSE' | 'BSE') {
  let value = item.exchange === (exchange ?? 'NSE') ? 20 : 0;
  if (normalize(item.trading_symbol) === query) value += 100;
  if (normalize(item.name) === query) value += 90;
  if (normalize(item.short_name ?? '') === query) value += 80;
  value += Math.max(0, 30 - Math.abs(normalize(item.name).length - query.length));
  return value;
}
