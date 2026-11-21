import type { CompanyIdentity } from './company';
import type { ResearchSourceMeta } from './research';
import type { TechnicalAnalysisResult } from './technical';
import type { SystematicStrategyResult } from './strategy';
import type { QtvtResult } from './qtvt';

export type InvestmentHorizon = 'intraday' | 'swing' | 'positional' | 'long-term';
export type DecisionClassification = 'BUY_SETUP' | 'WAIT' | 'HOLD_THESIS' | 'REDUCE_REVIEW' | 'EXIT_REVIEW' | 'GENERAL_ASSESSMENT';

export interface InvestorPositionInput {
  ownsStock: boolean;
  purchasePrice?: number;
  quantity?: number;
  availableCapital?: number;
  acceptableRiskPct?: number;
  horizon?: InvestmentHorizon;
  accountEquity?: number;
  maxDailyLoss?: number;
  currentDailyLoss?: number;
  maxOpenPositions?: number;
  currentOpenPositions?: number;
  maxConsecutiveLosses?: number;
  currentConsecutiveLosses?: number;
  cooldownActive?: boolean;
  maxTotalExposurePct?: number;
  currentTotalExposurePct?: number;
  maxStockAllocationPct?: number;
  maxSectorExposurePct?: number;
  currentSectorExposurePct?: number;
}

export interface ScoreFactor {
  name: string;
  score: number | null;
  weight: number;
  evidence: string;
  period?: string | null;
  sourceId?: string | null;
}

export interface ScoreMetricDetail {
  name: string;
  value: string;
  status: 'verified' | 'reported' | 'calculated' | 'unavailable';
  weight?: number;
  score?: number | null;
}

export interface ExplainableScore {
  category: string;
  score: number | null;
  maxScore: number;
  coveragePct: number;
  dataCoverage?: number;
  status: 'Strong' | 'Acceptable' | 'Mixed' | 'Weak' | 'Insufficient data' | 'Not evaluated';
  label: 'Strong' | 'Acceptable' | 'Mixed' | 'Weak' | 'Insufficient data' | 'Not evaluated';
  summary: string;
  explanation: string;
  methodology: string;
  supportingMetrics: ScoreMetricDetail[];
  missingData: string[];
  methodologyVersion: string;
  calculationTimestamp: string;
  factors: ScoreFactor[];
}

export interface EntryScenario {
  type: 'pullback' | 'breakout' | 'reversal';
  status: 'actionable-if-confirmed' | 'developing' | 'not-active';
  rangeLow: number;
  rangeHigh: number;
  technicalJustification: string[];
  fundamentalJustification: string[];
  requiredConfirmation: string[];
  invalidation: string;
  riskLevel: 'low' | 'moderate' | 'high';
}

export interface TargetScenario {
  label: 'Target 1' | 'Target 2' | 'Target 3';
  scenario: 'base' | 'bullish' | 'extended-bullish';
  price: number;
  upsidePct: number;
  riskReward: number | null;
  timeframe: string;
  confidence: 'High confluence' | 'Moderate confluence' | 'Low confluence';
  justification: string;
  conditions: string[];
}

export interface StopLossPlan {
  price: number;
  approach: string;
  justification: string[];
  riskPerShare: number;
  downsidePct: number;
  earlyExitConditions: string[];
  gapRiskNote: string;
}

export interface PositionSizingResult {
  policyVersion: string;
  capital: number;
  riskPct: number;
  riskAmount: number;
  riskPerShare: number;
  quantity: number;
  capitalRequired: number;
  estimatedExecutionCosts: number;
  estimatedMaximumPlannedLoss: number;
  blocked: boolean;
  blockedReasons: string[];
  constraints: string[];
  note: string;
}

export interface Week52Analysis {
  high: number;
  low: number;
  current: number;
  highTimestamp: string;
  lowTimestamp: string;
  distanceFromHighPct: number;
  distanceFromLowPct: number;
  declineFromHighPct: number;
  recoveryFromLowPct: number;
  position: 'near-high' | 'near-low' | 'middle-range';
  interpretation: string;
}

export interface InvestmentScenario {
  name: 'Bullish' | 'Base' | 'Bearish';
  evidence: string[];
  outcome: string;
  invalidation?: string;
}

export interface InvestmentDecisionResult {
  company: CompanyIdentity;
  classification: DecisionClassification;
  classificationLabel: string;
  complianceLabel: string;
  horizon: InvestmentHorizon;
  currentPrice: number;
  marketTimestamp: string;
  marketDataStatus: string;
  financialPeriod: string | null;
  fundamentalScore: ExplainableScore;
  valuationScore: ExplainableScore;
  technicalScore: ExplainableScore;
  riskScore: ExplainableScore;
  week52: Week52Analysis;
  entries: EntryScenario[];
  preferredEntry: EntryScenario | null;
  targets: TargetScenario[];
  stopLoss: StopLossPlan | null;
  positionSizing?: PositionSizingResult;
  scenarios: InvestmentScenario[];
  investmentThesis: {
    positives: string[];
    risks: string[];
    catalysts: string[];
    invalidationConditions: string[];
  };
  exitStrategy: string[];
  positionInput: InvestorPositionInput;
  technical: {
    primary: TechnicalAnalysisResult;
    confirmation?: TechnicalAnalysisResult;
  };
  sources: ResearchSourceMeta[];
  generatedAt: string;
  limitations: string[];
  systematic?: SystematicStrategyResult;
  qtvt?: QtvtResult;
}
