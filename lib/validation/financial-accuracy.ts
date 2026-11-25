// lib/validation/financial-accuracy.ts
// Strict financial data provenance, IST formatting, deterministic ratio checks, and zero-fabrication response validation.

import type { DataFreshnessState } from '@/lib/execution/tool-schemas';
import type { FinancialMetric, ResearchSourceMeta } from '@/types/research';

export interface ValidatedMarketSnapshot {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  instrumentType: 'EQ' | 'INDEX' | 'OTHER';
  currency: 'INR';
  price: number | null;
  dataTimestamp: string | null;
  retrievalTimestamp: string;
  provider: string;
  dataFreshness: DataFreshnessState;
  timezone: 'Asia/Kolkata';
}

export interface CalculatedRatioResult {
  value: number | null;
  unit: string;
  period: string | null;
  formula: string;
  status: 'calculated' | 'unavailable';
  reason?: string;
}

export interface EvidenceValidationReport {
  valid: boolean;
  warnings: string[];
  unverifiedNumericClaims: string[];
  freshnessMisrepresentation: boolean;
  hasMissingDataNotice: boolean;
}

export function formatIstDateTime(isoOrDate?: string | Date | null): string {
  if (!isoOrDate) return 'Unavailable';
  try {
    const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    if (Number.isNaN(date.getTime())) return String(isoOrDate);
    return `${date.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    })} IST`;
  } catch {
    return String(isoOrDate);
  }
}

/**
 * Ensures delayed or end-of-day datasets are NEVER mislabeled as live/real-time.
 */
export function labelMarketDataStatus(
  status?: DataFreshnessState | string | null,
  dataTimestamp?: string | null,
): { status: DataFreshnessState; label: string; isLive: boolean } {
  const normalized = (status ?? 'unavailable').toLowerCase().replaceAll('-', '_');
  const ageMs = dataTimestamp ? Date.now() - new Date(dataTimestamp).getTime() : Number.NaN;
  const stale = Number.isFinite(ageMs) && ageMs > 20 * 60_000;

  if (normalized === 'realtime' && !stale) {
    return { status: 'realtime', label: 'Real-time exchange feed (IST)', isLive: true };
  }
  if (normalized === 'delayed' || (normalized === 'realtime' && stale)) {
    return { status: 'delayed', label: 'Delayed market feed (not real-time)', isLive: false };
  }
  if (normalized === 'end_of_day' || normalized === 'historical') {
    return { status: 'end_of_day', label: 'End-of-day / historical exchange candles', isLive: false };
  }
  return { status: 'unavailable', label: 'Market feed status unavailable', isLive: false };
}

/**
 * Deterministic financial ratio calculator with strict missing-input and period-compatibility checks.
 */
export function calculateVerifiedRatio(params: {
  name: 'PE' | 'PB' | 'ROE' | 'ROCE' | 'DEBT_TO_EQUITY' | 'OPERATING_MARGIN' | 'NET_MARGIN' | 'REVENUE_GROWTH' | 'EARNINGS_GROWTH';
  numerator?: FinancialMetric | { value: number | null; period?: string | null; basis?: string };
  denominator?: FinancialMetric | { value: number | null; period?: string | null; basis?: string };
  requireSamePeriod?: boolean;
}): CalculatedRatioResult {
  const formulas: Record<typeof params.name, { formula: string; unit: string; pctScale: boolean }> = {
    PE: { formula: 'Price / Diluted EPS', unit: 'x', pctScale: false },
    PB: { formula: 'Price / Book Value Per Share', unit: 'x', pctScale: false },
    ROE: { formula: 'Net Profit / Shareholders Equity × 100', unit: '%', pctScale: true },
    ROCE: { formula: 'EBIT / Capital Employed × 100', unit: '%', pctScale: true },
    DEBT_TO_EQUITY: { formula: 'Total Debt / Shareholders Equity', unit: 'x', pctScale: false },
    OPERATING_MARGIN: { formula: 'Operating Profit / Revenue × 100', unit: '%', pctScale: true },
    NET_MARGIN: { formula: 'Net Profit / Revenue × 100', unit: '%', pctScale: true },
    REVENUE_GROWTH: { formula: '(Current Revenue - Prior Revenue) / |Prior Revenue| × 100', unit: '%', pctScale: true },
    EARNINGS_GROWTH: { formula: '(Current PAT - Prior PAT) / |Prior PAT| × 100', unit: '%', pctScale: true },
  };
  const spec = formulas[params.name];

  const numVal = toFiniteNumber(params.numerator?.value);
  const denVal = toFiniteNumber(params.denominator?.value);

  if (numVal == null || denVal == null) {
    return {
      value: null,
      unit: spec.unit,
      period: null,
      formula: spec.formula,
      status: 'unavailable',
      reason: `Cannot compute ${params.name}: required input values are missing.`,
    };
  }

  if (denVal === 0 || (denVal < 0 && (params.name === 'ROE' || params.name === 'DEBT_TO_EQUITY' || params.name === 'PB'))) {
    return {
      value: null,
      unit: spec.unit,
      period: null,
      formula: spec.formula,
      status: 'unavailable',
      reason: `Cannot compute meaningful ${params.name}: denominator (${denVal}) is zero or negative.`,
    };
  }

  const pA = params.numerator?.period?.trim() || null;
  const pB = params.denominator?.period?.trim() || null;
  const checkPeriod = params.requireSamePeriod !== false && params.name !== 'REVENUE_GROWTH' && params.name !== 'EARNINGS_GROWTH';
  if (checkPeriod && pA && pB && pA.toLowerCase() !== pB.toLowerCase()) {
    return {
      value: null,
      unit: spec.unit,
      period: null,
      formula: spec.formula,
      status: 'unavailable',
      reason: `Incompatible reporting periods (${pA} vs ${pB}) prevent safe ${params.name} calculation.`,
    };
  }

  const bA = params.numerator?.basis;
  const bB = params.denominator?.basis;
  if (bA && bB && bA !== 'Unspecified' && bB !== 'Unspecified' && bA !== bB) {
    return {
      value: null,
      unit: spec.unit,
      period: null,
      formula: spec.formula,
      status: 'unavailable',
      reason: `Incompatible accounting basis (${bA} vs ${bB}) prevents safe ${params.name} calculation.`,
    };
  }

  let computed: number;
  if (params.name === 'REVENUE_GROWTH' || params.name === 'EARNINGS_GROWTH') {
    computed = ((numVal - denVal) / Math.abs(denVal)) * 100;
  } else {
    computed = (numVal / denVal) * (spec.pctScale ? 100 : 1);
  }

  return {
    value: Math.round(computed * 100) / 100,
    unit: spec.unit,
    period: pA ?? pB,
    formula: spec.formula,
    status: 'calculated',
  };
}

/**
 * Validates final response prose against retrieved evidence, checking for unsupported numerical claims,
 * stale/delayed freshness misrepresentations, and missing source timestamps.
 */
export function validateResponseEvidence(params: {
  responseText: string;
  evidenceText: string;
  sources: ResearchSourceMeta[];
  freshness: DataFreshnessState;
  isResearchResponse: boolean;
}): EvidenceValidationReport {
  const warnings: string[] = [];
  const unverifiedNumericClaims: string[] = [];

  // 1. Freshness misrepresentation check
  const claimsRealtime = /\b(?:live\s+real[- ]?time|real[- ]?time\s+(?:tick|price|quote|session\s+close))\b/i.test(params.responseText);
  const freshnessMisrepresentation = claimsRealtime && params.freshness !== 'realtime';
  if (freshnessMisrepresentation) {
    warnings.push(`Response mentioned real-time market status although actual feed freshness is "${params.freshness}".`);
  }

  // 2. Source timestamps availability for research answers
  if (params.isResearchResponse && params.sources.length > 0) {
    const missingTimestamps = params.sources.filter((s) => !s.retrievedAt).length;
    if (missingTimestamps > 0) {
      warnings.push(`${missingTimestamps} referenced source(s) lacked retrieval timestamps.`);
    }
  }

  // 3. Cross-check currency & percentage numbers mentioned in research responses against supplied evidence
  if (params.isResearchResponse && params.evidenceText.length > 20) {
    const cleanEvidence = params.evidenceText.replace(/,/g, '');
    const claimedNumbers = [...params.responseText.matchAll(/(?:₹\s*|Rs\.?\s*)([0-9][0-9,]{1,}(?:\.[0-9]+)?)/g)]
      .map((m) => m[1].replace(/,/g, ''));
    const seen = new Set<string>();
    for (const numStr of claimedNumbers) {
      if (seen.has(numStr)) continue;
      seen.add(numStr);
      // Skip small rounding variants by checking exact integer or rounded prefix
      const num = Number(numStr);
      if (!Number.isFinite(num) || num < 10) continue;
      const intPrefix = String(Math.floor(num));
      if (!cleanEvidence.includes(numStr) && !cleanEvidence.includes(intPrefix)) {
        unverifiedNumericClaims.push(`₹${numStr}`);
      }
      if (unverifiedNumericClaims.length >= 6) break;
    }
    if (unverifiedNumericClaims.length > 0) {
      warnings.push(`Check numerical grounding for currency values not verbatim in retrieved evidence: ${unverifiedNumericClaims.join(', ')}`);
    }
  }

  const hasMissingDataNotice = /not available|unavailable|not disclosed|no .*retrieved/i.test(params.responseText);

  return {
    valid: !freshnessMisrepresentation,
    warnings,
    unverifiedNumericClaims,
    freshnessMisrepresentation,
    hasMissingDataNotice,
  };
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[₹,\s%xCrLakh]/gi, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
