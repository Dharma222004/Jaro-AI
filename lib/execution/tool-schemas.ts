// lib/execution/tool-schemas.ts
// Strict input/output Zod contracts and provenance envelope for every registered JARO AI tool.

import { z } from 'zod';

export type DataFreshnessState = 'realtime' | 'delayed' | 'end_of_day' | 'historical' | 'unavailable';

export interface ToolProvenance {
  source: string;
  provider: string;
  dataTimestamp: string | null;
  retrievalTimestamp: string;
  timezone: 'Asia/Kolkata';
  dataFreshness: DataFreshnessState;
  cached: boolean;
}

export interface ToolExecutionEnvelope<T = unknown> {
  toolName: string;
  status: 'completed' | 'failed' | 'denied';
  data: T | null;
  provenance: ToolProvenance;
  durationMs: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export const SymbolSchema = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9 &._-]+$/);
export const ExchangeSchema = z.enum(['NSE', 'BSE']).default('NSE');
export const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1mo']).default('1d');

export const ToolInputSchemas = {
  get_stock_quote: z.object({
    symbol: SymbolSchema,
    exchange: ExchangeSchema,
    isin: z.string().trim().max(20).optional(),
  }),
  get_historical_ohlcv: z.object({
    symbol: SymbolSchema,
    exchange: ExchangeSchema,
    timeframe: TimeframeSchema,
    isin: z.string().trim().max(20).optional(),
    fromIso: z.string().datetime().optional(),
    requireFresh: z.boolean().default(false),
  }),
  get_technical_indicators: z.object({
    symbol: SymbolSchema,
    exchange: ExchangeSchema,
    timeframe: TimeframeSchema,
    isin: z.string().trim().max(20).optional(),
    fromIso: z.string().datetime().optional(),
    requireFresh: z.boolean().default(false),
  }),
  resolve_company: z.object({
    query: z.string().trim().min(1).max(300),
  }),
  get_company_research: z.object({
    query: z.string().trim().min(1).max(500),
    company: z.object({
      name: z.string().min(1),
      ticker: z.string().min(1),
      exchange: z.enum(['NSE', 'BSE']),
      country: z.string().default('India'),
      isin: z.string().optional(),
      sector: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
    }),
    forceRefresh: z.boolean().default(false),
  }),
  screen_indian_equities: z.object({
    marketCapMinCr: z.number().nullable().optional(),
    marketCapMaxCr: z.number().nullable().optional(),
    minRevenueGrowthPct: z.number().nullable().optional(),
    minEarningsGrowthPct: z.number().nullable().optional(),
    minRoePct: z.number().nullable().optional(),
    minRocePct: z.number().nullable().optional(),
    maxDebtToEquity: z.number().nullable().optional(),
    minOperatingCashFlowCr: z.number().nullable().optional(),
    minFreeCashFlowCr: z.number().nullable().optional(),
    maxDistanceFrom52WeekLowPct: z.number().nullable().optional(),
    minInstitutionalHoldingPct: z.number().nullable().optional(),
    sector: z.string().nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
  }),
  analyse_market_indices: z.object({
    indexName: z.enum(['NIFTY 50', 'NIFTY BANK', 'NIFTY NEXT 50', 'INDIA VIX', 'SENSEX', 'NIFTY IT', 'NIFTY AUTO', 'NIFTY PHARMA', 'NIFTY FMCG', 'NIFTY METAL', 'NIFTY REALTY', 'NIFTY OIL AND GAS']).default('NIFTY 50'),
    timeframe: TimeframeSchema,
  }),
  search_financial_documents: z.object({
    query: z.string().trim().min(1).max(500),
    documentIds: z.array(z.string().max(100)).max(20).optional(),
    companyId: z.string().max(100).optional(),
    topK: z.number().int().min(1).max(20).default(6),
  }),
  get_user_portfolio: z.object({
    ticker: SymbolSchema.optional(),
  }),
  optimize_user_portfolio: z.object({
    positions: z.array(z.object({
      instrumentKey: z.string(),
      ticker: z.string(),
      exchange: z.string(),
      sector: z.string(),
      side: z.enum(['long', 'short']),
      quantity: z.number().nonnegative(),
      entryPrice: z.number().nonnegative(),
      currentPrice: z.number().positive(),
      marketValue: z.number().nonnegative().default(0),
      unrealizedPnl: z.number().default(0),
      unrealizedPnlPct: z.number().default(0),
      weightPct: z.number().default(0),
      riskContributionPct: z.number().default(0),
      stopLoss: z.number().optional(),
      target: z.number().optional(),
      lastUpdated: z.string().default(() => new Date().toISOString()),
    })).min(1).max(100),
    availableCapital: z.number().positive(),
    accountEquity: z.number().positive(),
  }),
} as const;

export type RegisteredToolName = keyof typeof ToolInputSchemas;
