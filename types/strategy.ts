import type { TechnicalAnalysisResult, TechnicalTimeframe } from './technical';

export type StrategyId = 'trend_pullback_continuation' | 'breakout_retest';
export type TradeSetupStatus =
  | 'ENTRY_AVAILABLE'
  | 'WAIT_FOR_CONFIRMATION'
  | 'WAIT_FOR_PULLBACK'
  | 'BREAKOUT_NOT_CONFIRMED'
  | 'PRICE_EXTENDED_DO_NOT_CHASE'
  | 'SETUP_INVALIDATED'
  | 'NO_VALID_SETUP'
  | 'INSUFFICIENT_MARKET_DATA';

export interface StrategyGate {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'pending' | 'unavailable';
  reason: string;
  value?: string | number | null;
  mandatory: boolean;
}

export interface MarketRegimeAnalysis {
  classification: 'bullish' | 'bearish' | 'sideways' | 'high-volatility' | 'weakening' | 'uncertain';
  score: number | null;
  niftyTrend: string;
  niftyAboveSma50: boolean | null;
  niftyAboveSma200: boolean | null;
  sma50Direction: 'rising' | 'falling' | 'flat' | 'unavailable';
  structure: string;
  vix: number | null;
  volatilityState: 'normal' | 'elevated' | 'high' | 'unavailable';
  breadthStatus: 'unavailable' | 'supportive' | 'weak';
  reasoning: string[];
  timestamp: string | null;
}

export interface SectorStrengthAnalysis {
  sector: string;
  indexName: string | null;
  classification: 'leading' | 'improving' | 'neutral' | 'weakening' | 'underperforming' | 'unavailable';
  sectorReturnPct: number | null;
  benchmarkReturnPct: number | null;
  relativeReturnPct: number | null;
  trend: string | null;
  reasoning: string[];
}

export interface StockStrengthAnalysis {
  stockReturnPct: number | null;
  relativeToNiftyPct: number | null;
  relativeToSectorPct: number | null;
  averageTradedValueCr: number | null;
  relativeVolume: number | null;
  atrPct: number | null;
  liquidity: 'sufficient' | 'limited' | 'insufficient' | 'unavailable';
  spreadPct: number | null;
  reasoning: string[];
}

export interface StrategyEntryPlan {
  zoneLabel: 'Pullback support zone' | 'Retest support zone';
  zoneLow: number;
  zoneHigh: number;
  triggerPrice: number;
  triggerCondition: string;
  maximumEntryPrice: number;
  observedPrice: number;
  confirmationTimeframe: TechnicalTimeframe;
  expiry: string;
  extended: boolean;
}

export interface StrategyStopPlan {
  price: number;
  structuralReference: number;
  atrBuffer: number;
  atrMultiplier: number;
  riskPerShare: number;
  downsidePct: number;
  reason: string;
  gapRisk: string;
}

export interface StrategyTarget {
  label: 'Target 1' | 'Target 2' | 'Target 3';
  price: number;
  method: string;
  grossRewardRisk: number;
  netRewardRisk: number;
  upsidePct: number;
}

export interface TradingCostEstimate {
  buyCostBps: number;
  sellCostBps: number;
  slippageBpsPerSide: number;
  estimatedRoundTripCost: number;
  estimatedPerShareCost: number;
  assumptions: string[];
}

export interface StrategyScoreComponent {
  id: string;
  label: string;
  value: number | null;
  weight: number;
  contribution: number | null;
  evidence: string;
}

export interface StrategyEvaluation {
  strategyId: StrategyId;
  strategyName: string;
  strategyVersion: string;
  releaseStatus: 'research' | 'shadow' | 'validated';
  status: TradeSetupStatus;
  rulesQualified: boolean;
  eligible: boolean;
  horizon: 'intraday' | 'swing' | 'positional';
  setupTimeframe: TechnicalTimeframe;
  confirmationTimeframe: TechnicalTimeframe;
  detectedAt: string;
  marketRegime: MarketRegimeAnalysis;
  sectorStrength: SectorStrengthAnalysis;
  stockStrength: StockStrengthAnalysis;
  gates: StrategyGate[];
  score: number | null;
  scoreCoveragePct: number;
  scoreComponents: StrategyScoreComponent[];
  entry: StrategyEntryPlan | null;
  stop: StrategyStopPlan | null;
  targets: StrategyTarget[];
  costs: TradingCostEstimate | null;
  setupConditions: string[];
  invalidationConditions: string[];
  riskFilters: string[];
  missingData: string[];
  methodology: string[];
  audit: {
    instrumentKey: string;
    candleCount: number;
    lastCandleAt: string | null;
    marketDataStatus: string;
    inputsHash: string;
  };
}

export interface SystematicStrategyResult {
  selected: StrategyEvaluation | null;
  strategies: StrategyEvaluation[];
  marketRegime: MarketRegimeAnalysis;
  sectorStrength: SectorStrengthAnalysis;
  stockStrength: StockStrengthAnalysis;
  generatedAt: string;
  benchmark: Pick<TechnicalAnalysisResult, 'instrument' | 'timeframe' | 'lastCandleAt' | 'dataStatus'>;
}
