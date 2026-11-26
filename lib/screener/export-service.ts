// lib/screener/export-service.ts
// Generates RFC-4180 CSV exports for verified Stock Screener results with provenance & timestamps.

import type { ScreenerCandidateRow } from '@/types/screener';

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildScreenerCsv(rows: ScreenerCandidateRow[]): string {
  const headers = [
    'Company',
    'NSE Symbol',
    'BSE Code',
    'ISIN',
    'Exchange',
    'Sector',
    'Price (INR)',
    'SMA 50 (INR)',
    'Diff vs SMA 50 (%)',
    'Daily Volume (Shares)',
    'Market Cap (INR Cr)',
    'ROE (%)',
    'Debt/Equity',
    'RSI (14)',
    'Quote Provider',
    'Candle Provider',
    'Data Freshness',
    'Price Timestamp',
    'Candle Date',
  ];

  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([
      r.name,
      r.nseSymbol ?? '',
      r.bseCode ?? '',
      r.isin ?? '',
      r.exchangeLabel,
      r.sector ?? '',
      r.price.toFixed(2),
      r.sma50 != null ? r.sma50.toFixed(2) : '',
      r.diffFromSma50Pct != null ? r.diffFromSma50Pct.toFixed(2) : '',
      r.dailyVolumeShares != null ? Math.round(r.dailyVolumeShares) : '',
      r.marketCapCr != null ? Math.round(r.marketCapCr) : '',
      r.roePct != null ? r.roePct.toFixed(2) : '',
      r.debtToEquity != null ? r.debtToEquity.toFixed(2) : '',
      r.rsi14 != null ? r.rsi14.toFixed(2) : '',
      r.quoteProvider,
      r.candleProvider ?? '',
      r.dataFreshness,
      r.priceTimestamp,
      r.candleDate ?? '',
    ].map(csvEscape).join(','));
  }

  return lines.join('\r\n');
}
