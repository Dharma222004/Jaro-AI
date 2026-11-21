export type PositionSide = 'long' | 'short';

export interface PortfolioPosition {
  instrumentKey: string;
  ticker: string;
  exchange: string;
  sector: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  weightPct: number;
  riskContributionPct: number;
  stopLoss?: number;
  target?: number;
  strategyId?: string;
  strategyVersion?: string;
  lastUpdated: string;
}

export interface PortfolioRiskBudget {
  maxTotalExposurePct: number;
  maxSinglePositionPct: number;
  maxSectorExposurePct: number;
  maxDailyLossPct: number;
  maxCorrelationClusterPct: number;
}

export interface CorrelationEntry {
  instrumentKeyA: string;
  instrumentKeyB: string;
  correlation: number; // -1 to 1
  lookbackDays: number;
}

export interface PortfolioOptimizationInput {
  positions: PortfolioPosition[];
  availableCapital: number;
  accountEquity: number;
  riskBudget: PortfolioRiskBudget;
  correlations?: CorrelationEntry[];
  currentDailyLoss?: number;
  currentOpenPositions?: number;
  currentConsecutiveLosses?: number;
  cooldownActive?: boolean;
}

export interface OptimizedPosition {
  instrumentKey: string;
  ticker: string;
  sector: string;
  suggestedQuantity: number;
  suggestedEntry: number;
  suggestedStop: number;
  suggestedTarget: number | null;
  weightPct: number;
  riskAmount: number;
  riskContributionPct: number;
  correlationAdjusted: boolean;
  blocked: boolean;
  blockedReasons: string[];
  rationale: string[];
}

export interface PortfolioOptimizationResult {
  totalCapital: number;
  deployedCapital: number;
  availableCapital: number;
  totalExposurePct: number;
  totalRiskPct: number;
  positions: OptimizedPosition[];
  warnings: string[];
  blockedPositions: OptimizedPosition[];
  diversificationScore: number; // 0-100
  maxCorrelation: number;
  generatedAt: string;
  policyVersion: string;
}

export const DEFAULT_PORTFOLIO_RISK_BUDGET: PortfolioRiskBudget = {
  maxTotalExposurePct: 100,
  maxSinglePositionPct: 10,
  maxSectorExposurePct: 25,
  maxDailyLossPct: 2,
  maxCorrelationClusterPct: 30,
};

export const PORTFOLIO_OPTIMIZATION_POLICY_VERSION = 'JARO-PORTFOLIO-1.0.0';
