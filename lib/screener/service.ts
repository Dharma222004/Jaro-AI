// lib/screener/service.ts
// Dedicated StockScreenerService orchestrating NL parsing, canonical NSE/BSE universe loading,
// batched multi-provider market data, deterministic filtering, sorting, and provenance reporting.

import { randomUUID } from 'node:crypto';
import type { ConversationContext } from '@/types/conversation';
import type { ResearchSourceMeta } from '@/types/research';
import type { ScreenerExecutionResult, ScreenerSpec } from '@/types/screener';
import { formatIstDateTime } from '@/lib/validation/financial-accuracy';
import {
  describeScreenerSpec,
  mergeScreenerFollowUp,
  parseNaturalLanguageScreen,
  validateScreenerSpec,
} from './nl-parser';
import { isScreenerFollowUp } from './intent-classifier';
import { loadCanonicalEquityUniverse } from './universe-provider';
import { collectScreenerMarketData, isNseMarketOpenIst } from './market-data-provider';
import { evaluateScreenerCandidates } from './evaluator';

export async function runStockScreener(params: {
  query: string;
  specOverride?: ScreenerSpec;
  context?: ConversationContext;
  signal?: AbortSignal;
  onProgress?: (detail: string) => void;
}): Promise<ScreenerExecutionResult> {
  const { query, specOverride, context, signal, onProgress } = params;
  const jobId = `scr_${randomUUID().slice(0, 12)}`;

  // 1. Parse / merge Spec
  let spec: ScreenerSpec;
  if (specOverride) {
    spec = specOverride;
  } else if (context?.activeScreenerSpec && isScreenerFollowUp(query, context)) {
    spec = mergeScreenerFollowUp(context.activeScreenerSpec, query);
  } else {
    spec = parseNaturalLanguageScreen(query, context);
  }

  const validation = validateScreenerSpec(spec);
  if (!validation.valid) {
    throw new Error(`Invalid screening criteria: ${validation.errors.join('; ')}`);
  }

  // 2. Load canonical deduplicated NSE/BSE equity universe
  onProgress?.('Loading canonical NSE/BSE listed equity universe');
  const universeRes = await loadCanonicalEquityUniverse({
    exchanges: spec.exchanges,
    includeSme: spec.includeSme,
    sector: spec.sector,
  });

  // 3. Collect batched quotes, completed daily candles, and fundamentals
  const dataRes = await collectScreenerMarketData({
    universe: universeRes.instruments,
    spec,
    signal,
    onProgress,
  });

  // 4. Deterministic evaluation & ranking
  onProgress?.(`Evaluating ${spec.conditions.length} filter conditions across ${dataRes.candidates.length} securities`);
  const evalRes = evaluateScreenerCandidates(dataRes.candidates, spec);

  const combinedExclusions: Record<string, number> = { ...dataRes.exclusionReasons };
  for (const [reason, cnt] of Object.entries(evalRes.exclusionReasons)) {
    combinedExclusions[reason] = (combinedExclusions[reason] ?? 0) + cnt;
  }

  const totalExcluded = Math.max(0, dataRes.validQuoteCount - evalRes.matched.length);
  const limitations = [...validation.warnings, ...dataRes.warnings];
  if (spec.conditions.some((c) => c.field === 'roce_pct')) {
    limitations.push('ROCE requires audited balance-sheet capital employed; verify ROCE against exchange filings if unavailable from quote feeds.');
  }

  const sources: ResearchSourceMeta[] = [
    ...Object.keys(dataRes.providerBreakdown).map((provider, i) => ({
      id: `scr_provider_${i + 1}`,
      url: provider === 'upstox'
        ? 'https://upstox.com/developer/api-documentation/get-full-market-quote-v3/'
        : provider === 'angelone'
          ? 'https://smartapi.angelone.in/'
          : provider === 'mstock'
            ? 'https://api.mstock.trade/'
            : 'https://finance.yahoo.com/',
      title: `${provider.replace('_', ' ').toUpperCase()} Market & Candle Feed (${dataRes.providerBreakdown[provider]} instruments)`,
      domain: provider === 'upstox' ? 'upstox.com' : provider === 'angelone' ? 'angelone.in' : provider === 'mstock' ? 'mstock.trade' : 'finance.yahoo.com',
      sourceType: 'financial_database' as const,
      authority: provider === 'yahoo_finance' ? 'medium' as const : 'high' as const,
      retrievedAt: new Date().toISOString(),
      snippet: `Evaluated ${dataRes.validQuoteCount} securities from ${universeRes.sourceNotes.join('; ')}.`,
    })),
  ];

  const now = new Date();
  const status: ScreenerExecutionResult['status'] = signal?.aborted
    ? 'cancelled'
    : limitations.length > 0 && dataRes.validQuoteCount < universeRes.instruments.length
      ? 'partial'
      : 'completed';

  return {
    jobId,
    status,
    query: spec.rawQuery,
    spec,
    interpretedFilterLabels: describeScreenerSpec(spec),
    rows: evalRes.matched,
    coverage: {
      totalEligibleSecurities: universeRes.instruments.length,
      resolvedInstruments: universeRes.instruments.length,
      validQuoteCount: dataRes.validQuoteCount,
      sufficientCandlesCount: dataRes.sufficientCandlesCount,
      verifiedMarketCapCount: dataRes.verifiedMarketCapCount,
      matchedCount: evalRes.matched.length,
      excludedCount: totalExcluded,
      unavailableCount: evalRes.unavailableCount,
      exclusionReasons: combinedExclusions,
      providerBreakdown: dataRes.providerBreakdown,
      warnings: limitations,
    },
    marketStatus: isNseMarketOpenIst(now) ? 'open' : 'closed',
    executionTimestampIst: formatIstDateTime(now),
    retrievedAt: now.toISOString(),
    sources,
    limitations,
  };
}
