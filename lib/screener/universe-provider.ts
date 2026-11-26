// lib/screener/universe-provider.ts
// Canonical NSE + BSE equity universe builder with ISIN-based deduplication,
// mainboard/SME classification, and non-equity exclusion.

import { prisma } from '@/lib/database/client';
import { getInstrumentMaster } from '@/lib/upstox/instruments';
import { CANONICAL_INSTRUMENTS } from '@/lib/broker/instrument-registry';
import { INDIAN_EQUITY_UNIVERSE } from '@/lib/research/conversational-collector';
import type { CanonicalEquityInstrument, ScreenerExchangeFilter } from '@/types/screener';
import type { UpstoxInstrument } from '@/types/technical';

const NON_EQUITY_NAME_RE = /\b(ETF|NIFTY\s*\d*|SENSEX|BEES|MUTUAL\s*FUND|LIQUID|GILT|BOND|NCD|DEBENTURE|PREFERENCE|WARRANT|REIT|INVIT|SOVEREIGN\s*GOLD|SGB|T-?BILL|INDEX\s*FUND)\b/i;
const SME_INSTRUMENT_TYPES = new Set(['SM', 'ST', 'M', 'MT']);

function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\b(LIMITED|LTD|PRIVATE|PVT|INDIA|THE)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function isOrdinaryEquity(item: UpstoxInstrument): boolean {
  if (item.segment !== 'NSE_EQ' && item.segment !== 'BSE_EQ') return false;
  if (NON_EQUITY_NAME_RE.test(item.name) || NON_EQUITY_NAME_RE.test(item.trading_symbol)) return false;
  // Exclude suspended / GSM-restricted / illiquid Z series if marked
  if (item.segment === 'BSE_EQ' && item.instrument_type === 'Z') return false;
  return true;
}

function isSmeInstrument(item: UpstoxInstrument): boolean {
  return SME_INSTRUMENT_TYPES.has((item.instrument_type || '').toUpperCase())
    || /\bSME\b/i.test(item.name);
}

/**
 * Loads and deduplicates the canonical NSE/BSE equity universe.
 * Combines live Upstox NSE/BSE instrument masters (when available) with
 * database Company records and the curated CANONICAL_INSTRUMENTS registry.
 */
export async function loadCanonicalEquityUniverse(options: {
  exchanges?: ScreenerExchangeFilter;
  includeSme?: boolean;
  sector?: string | null;
} = {}): Promise<{
  instruments: CanonicalEquityInstrument[];
  rawMasterCount: number;
  sourceNotes: string[];
}> {
  const exchangeFilter = options.exchanges ?? 'BOTH';
  const includeSme = options.includeSme ?? false;
  const sourceNotes: string[] = [];

  const byKey = new Map<string, CanonicalEquityInstrument>();
  const byIsin = new Map<string, CanonicalEquityInstrument>();
  const byTicker = new Map<string, CanonicalEquityInstrument>();
  const byName = new Map<string, CanonicalEquityInstrument>();

  const registerAliases = (inst: CanonicalEquityInstrument) => {
    if (inst.isin) byIsin.set(inst.isin, inst);
    if (inst.nseSymbol) byTicker.set(inst.nseSymbol, inst);
    if (inst.primaryTicker) byTicker.set(inst.primaryTicker, inst);
    const normName = normalizeCompanyName(inst.name);
    if (normName) byName.set(normName, inst);
  };

  const upsertEntry = (entry: Partial<CanonicalEquityInstrument> & { name: string; primaryTicker: string }) => {
    const normName = normalizeCompanyName(entry.name);
    const key = entry.isin
      ? `ISIN:${entry.isin}`
      : `NAME:${normName || entry.primaryTicker}`;

    const existing =
      (entry.isin ? byIsin.get(entry.isin) : undefined) ??
      byTicker.get(entry.nseSymbol ?? entry.primaryTicker) ??
      (normName ? byName.get(normName) : undefined) ??
      byKey.get(key);

    if (!existing) {
      const created: CanonicalEquityInstrument = {
        companyId: entry.companyId ?? entry.isin ?? entry.primaryTicker,
        isin: entry.isin ?? null,
        name: entry.name,
        primaryTicker: entry.nseSymbol ?? entry.primaryTicker,
        nseSymbol: entry.nseSymbol ?? null,
        bseCode: entry.bseCode ?? null,
        nseInstrumentKey: entry.nseInstrumentKey ?? null,
        bseInstrumentKey: entry.bseInstrumentKey ?? null,
        exchanges: entry.exchanges ? [...new Set(entry.exchanges)] : [],
        segment: entry.segment ?? 'mainboard',
        sector: entry.sector ?? null,
        industry: entry.industry ?? null,
      };
      byKey.set(key, created);
      registerAliases(created);
      return;
    }

    if (entry.isin && !existing.isin) existing.isin = entry.isin;
    if (entry.nseSymbol && !existing.nseSymbol) existing.nseSymbol = entry.nseSymbol;
    if (entry.bseCode && !existing.bseCode) existing.bseCode = entry.bseCode;
    if (entry.nseInstrumentKey && !existing.nseInstrumentKey) existing.nseInstrumentKey = entry.nseInstrumentKey;
    if (entry.bseInstrumentKey && !existing.bseInstrumentKey) existing.bseInstrumentKey = entry.bseInstrumentKey;
    if (entry.nseSymbol) existing.primaryTicker = entry.nseSymbol;
    if (entry.exchanges) {
      existing.exchanges = [...new Set([...existing.exchanges, ...entry.exchanges])];
    }
    if (!existing.sector && entry.sector) existing.sector = entry.sector;
    if (!existing.industry && entry.industry) existing.industry = entry.industry;
    if (entry.companyId && existing.companyId === (existing.isin ?? existing.primaryTicker)) {
      existing.companyId = entry.companyId;
    }
    registerAliases(existing);
  };

  // 1. Seed from DB Company Master (fast, preserves sector & industry metadata)
  const dbCompanies = await prisma.company.findMany({
    select: { id: true, name: true, ticker: true, exchange: true, sector: true, industry: true },
  }).catch(() => []);

  for (const c of dbCompanies) {
    const ex = c.exchange?.toUpperCase() === 'BSE' ? 'BSE' : 'NSE';
    upsertEntry({
      companyId: c.id,
      name: c.name,
      primaryTicker: c.ticker.toUpperCase(),
      nseSymbol: ex === 'NSE' ? c.ticker.toUpperCase() : null,
      bseCode: ex === 'BSE' ? c.ticker.toUpperCase() : null,
      exchanges: [ex],
      sector: c.sector,
      industry: c.industry,
    });
  }

  // 2. Seed from CANONICAL_INSTRUMENTS & INDIAN_EQUITY_UNIVERSE (ISIN + broker tokens)
  for (const item of Object.values(CANONICAL_INSTRUMENTS)) {
    upsertEntry({
      isin: item.isin,
      name: item.name,
      primaryTicker: item.symbol,
      nseSymbol: item.exchange === 'NSE' ? item.symbol : null,
      bseCode: item.exchange === 'BSE' ? item.symbol : null,
      nseInstrumentKey: item.exchange === 'NSE' ? item.upstoxKey : null,
      bseInstrumentKey: item.exchange === 'BSE' ? item.upstoxKey : null,
      exchanges: [item.exchange],
    });
  }

  for (const item of INDIAN_EQUITY_UNIVERSE) {
    upsertEntry({
      name: item.name,
      primaryTicker: item.ticker,
      nseSymbol: item.ticker,
      exchanges: ['NSE'],
    });
  }

  // 3. Hydrate full NSE + BSE exchange master from Upstox Instrument Master
  const master = await getInstrumentMaster().catch(() => [] as UpstoxInstrument[]);
  let rawMasterCount = 0;
  if (master.length > 0) {
    sourceNotes.push(`Upstox NSE/BSE instrument master (${master.length} raw contracts)`);
    for (const item of master) {
      if (!isOrdinaryEquity(item)) continue;
      const sme = isSmeInstrument(item);
      if (!includeSme && sme) continue;
      rawMasterCount += 1;

      const isNse = item.exchange === 'NSE';
      const ex: 'NSE' | 'BSE' = isNse ? 'NSE' : 'BSE';
      upsertEntry({
        isin: item.isin ?? null,
        name: item.name,
        primaryTicker: item.trading_symbol,
        nseSymbol: isNse ? item.trading_symbol : null,
        bseCode: !isNse ? item.trading_symbol : null,
        nseInstrumentKey: isNse ? item.instrument_key : null,
        bseInstrumentKey: !isNse ? item.instrument_key : null,
        exchanges: [ex],
        segment: sme ? 'sme' : 'mainboard',
      });
    }
  } else {
    sourceNotes.push('Canonical DB & curated Indian equity registry (Upstox instrument master offline)');
  }

  // 4. Apply exchange & sector filters
  let filtered = Array.from(byKey.values()).filter((inst) => {
    if (!includeSme && inst.segment === 'sme') return false;
    if (exchangeFilter === 'NSE') return inst.exchanges.includes('NSE') || Boolean(inst.nseSymbol);
    if (exchangeFilter === 'BSE') return inst.exchanges.includes('BSE') || Boolean(inst.bseCode);
    return true;
  });

  if (options.sector) {
    const sLower = options.sector.toLowerCase();
    const sectorMatches = filtered.filter((inst) =>
      inst.sector?.toLowerCase().includes(sLower) || inst.industry?.toLowerCase().includes(sLower),
    );
    // Keep sector-tagged subset when available; downstream fundamental fetch will also filter dynamically
    if (sectorMatches.length > 0) {
      filtered = sectorMatches;
    }
  }

  return {
    instruments: filtered,
    rawMasterCount: rawMasterCount || filtered.length,
    sourceNotes,
  };
}
