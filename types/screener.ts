import type { ResearchSourceMeta } from './research';

export type ScreenerExchangeFilter = 'NSE' | 'BSE' | 'BOTH';

export type ScreenerLogicalOperator = 'AND' | 'OR';

export type VolumeMode =
  | 'latest_completed_session'
  | 'intraday_cumulative'
  | 'avg_5d'
  | 'avg_20d'
  | 'avg_50d'
  | 'relative_volume';

export type ScreenerDataFreshness =
  | 'live'
  | 'delayed'
  | 'latest_completed_session'
  | 'historical'
  | 'cached'
  | 'unavailable';

export type ScreenerOperator = '>' | '>=' | '<' | '<=' | '=' | 'between' | 'crosses_above' | 'crosses_below';

export type ScreenerField =
  | 'daily_close'
  | 'daily_volume'
  | 'intraday_volume'
  | 'avg_volume_5d'
  | 'avg_volume_20d'
  | 'avg_volume_50d'
  | 'relative_volume'
  | 'daily_turnover_cr'
  | 'market_cap_cr'
  | 'sma_5'
  | 'sma_10'
  | 'sma_20'
  | 'sma_50'
  | 'sma_100'
  | 'sma_200'
  | 'ema_9'
  | 'ema_20'
  | 'ema_50'
  | 'ema_100'
  | 'ema_200'
  | 'diff_from_sma_50_pct'
  | 'rsi_14'
  | 'macd_above_signal'
  | 'macd_bullish_crossover'
  | 'stochastic_k'
  | 'atr_pct'
  | 'bb_width_pct'
  | 'bb_contraction'
  | 'near_52w_high'
  | 'near_52w_low'
  | 'breakout_52w_high'
  | 'distance_from_52w_high_pct'
  | 'distance_from_52w_low_pct'
  | 'higher_highs_lows'
  | 'support_retest'
  | 'resistance_breakout'
  | 'roe_pct'
  | 'roce_pct'
  | 'roa_pct'
  | 'gross_margin_pct'
  | 'ebitda_margin_pct'
  | 'operating_margin_pct'
  | 'net_margin_pct'
  | 'revenue_growth_pct'
  | 'operating_profit_growth_pct'
  | 'net_profit_growth_pct'
  | 'eps_growth_pct'
  | 'cagr_3y_pct'
  | 'cagr_5y_pct'
  | 'debt_to_equity'
  | 'current_ratio'
  | 'interest_coverage'
  | 'operating_cash_flow_cr'
  | 'free_cash_flow_cr'
  | 'net_debt_cr'
  | 'pe'
  | 'pb'
  | 'ev_to_ebitda'
  | 'peg'
  | 'dividend_yield_pct'
  | 'promoter_holding_pct'
  | 'promoter_pledge_pct'
  | 'fii_holding_pct'
  | 'dii_holding_pct';

export interface ScreenerCondition {
  id: string;
  field: ScreenerField;
  operator: ScreenerOperator;
  /** Numeric threshold (in normalized unit: shares for volume, Cr for INR amounts, % for pct) */
  value?: number;
  /** Upper bound when operator === 'between' */
  valueTo?: number;
  /** Right-hand side field when comparing two fields, e.g. daily_close > sma_50 or sma_50 > sma_200 */
  referenceField?: ScreenerField;
  /** Moving average / indicator period when applicable */
  period?: number;
  timeframe: '1d' | '1w';
  unit?: string;
  label: string;
}

export type ScreenerSortField =
  | 'market_cap_cr'
  | 'daily_volume'
  | 'price'
  | 'daily_turnover_cr'
  | 'relative_volume'
  | 'roce_pct'
  | 'roe_pct'
  | 'revenue_growth_pct'
  | 'net_profit_growth_pct'
  | 'rsi_14'
  | 'diff_from_sma_50_pct'
  | 'pe';

export interface ScreenerSpec {
  intent: 'stock_screening';
  rawQuery: string;
  exchanges: ScreenerExchangeFilter;
  securityUniverse: 'active_listed_equity';
  includeSme: boolean;
  excludeNonEquity: boolean;
  sector?: string | null;
  volumeMode: VolumeMode;
  conditions: ScreenerCondition[];
  logicalOperator: ScreenerLogicalOperator;
  sortBy: ScreenerSortField;
  sortOrder: 'DESC' | 'ASC';
  limit: number;
}

export interface ScreenerValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CanonicalEquityInstrument {
  companyId: string;
  isin: string | null;
  name: string;
  primaryTicker: string;
  nseSymbol: string | null;
  bseCode: string | null;
  nseInstrumentKey: string | null;
  bseInstrumentKey: string | null;
  exchanges: Array<'NSE' | 'BSE'>;
  segment: 'mainboard' | 'sme';
  sector: string | null;
  industry: string | null;
}

export interface ConditionEvaluation {
  conditionId: string;
  label: string;
  passed: boolean | 'unavailable';
  actualDisplay: string;
  reason?: string;
}

export interface ScreenerCandidateRow {
  companyId: string;
  isin: string | null;
  name: string;
  primaryTicker: string;
  nseSymbol: string | null;
  bseCode: string | null;
  exchangeLabel: 'NSE' | 'BSE' | 'NSE/BSE';
  segment: 'mainboard' | 'sme';
  sector: string | null;
  industry: string | null;

  price: number;
  previousClose: number | null;
  changePct: number | null;

  // Moving averages & difference
  sma5: number | null;
  sma10: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  diffFromSma50Pct: number | null;
  prevCloseBelowSma50?: boolean | null;

  // Momentum & Volatility
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochasticK: number | null;
  atrPct: number | null;
  bbWidthPct: number | null;

  // Volume & Turnover
  dailyVolumeShares: number | null;
  dailyTurnoverCr: number | null;
  avgVolume5d: number | null;
  avgVolume20d: number | null;
  avgVolume50d: number | null;
  relativeVolume: number | null;
  volumeMode: VolumeMode;

  // 52W & Structure
  high52W: number | null;
  low52W: number | null;
  distanceFrom52WeekHighPct: number | null;
  distanceFrom52WeekLowPct: number | null;
  higherHighsLows: boolean | null;
  supportLevel: number | null;
  resistanceLevel: number | null;

  // Market Cap (INR Crore)
  marketCapCr: number | null;
  marketCapSource: string | null;
  sharesOutstanding: number | null;

  // Fundamentals
  roePct: number | null;
  rocePct: number | null;
  roaPct: number | null;
  grossMarginPct: number | null;
  ebitdaMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  revenueGrowthPct: number | null;
  operatingProfitGrowthPct: number | null;
  netProfitGrowthPct: number | null;
  epsGrowthPct: number | null;
  cagr3yPct: number | null;
  cagr5yPct: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  operatingCashFlowCr: number | null;
  freeCashFlowCr: number | null;
  netDebtCr: number | null;
  pe: number | null;
  pb: number | null;
  evToEbitda: number | null;
  peg: number | null;
  dividendYieldPct: number | null;
  promoterHoldingPct: number | null;
  promoterPledgePct: number | null;
  fiiHoldingPct: number | null;
  diiHoldingPct: number | null;
  fundamentalPeriod: string | null;
  fundamentalBasis: 'consolidated' | 'standalone' | null;

  // Provenance & Audit
  quoteProvider: string;
  candleProvider: string | null;
  fundamentalProvider: string | null;
  dataFreshness: ScreenerDataFreshness;
  priceTimestamp: string;
  candleDate: string | null;

  conditionResults: ConditionEvaluation[];
  matched: boolean;
  missingData: string[];
  exclusionReason?: string;
}

export interface ScreenerCoverageReport {
  totalEligibleSecurities: number;
  resolvedInstruments: number;
  validQuoteCount: number;
  sufficientCandlesCount: number;
  verifiedMarketCapCount: number;
  matchedCount: number;
  excludedCount: number;
  unavailableCount: number;
  exclusionReasons: Record<string, number>;
  providerBreakdown: Record<string, number>;
  warnings: string[];
}

export interface ScreenerExecutionResult {
  jobId: string;
  status: 'completed' | 'partial' | 'cancelled' | 'failed';
  query: string;
  spec: ScreenerSpec;
  interpretedFilterLabels: string[];
  rows: ScreenerCandidateRow[];
  coverage: ScreenerCoverageReport;
  marketStatus: 'open' | 'closed';
  executionTimestampIst: string;
  retrievedAt: string;
  sources: ResearchSourceMeta[];
  limitations: string[];
  savedScreenerId?: string;
}

export interface SavedScreenerRecord {
  id: string;
  name: string;
  spec: ScreenerSpec;
  lastRunAt: string | null;
  lastMatchCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenerJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'cancelled' | 'failed';
  totalBatches: number;
  completedBatches: number;
  eligibleCount: number;
  evaluatedCount: number;
  matchedCount: number;
  excludedCount: number;
  updatedAt: string;
  result?: ScreenerExecutionResult;
  error?: string;
}
