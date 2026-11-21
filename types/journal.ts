import type {
  MarketRegimeAnalysis,
  SectorStrengthAnalysis,
  StockStrengthAnalysis,
  StrategyEntryPlan,
  StrategyGate,
  StrategyStopPlan,
  StrategyTarget,
  TradingCostEstimate,
  StrategyEvaluation,
} from './strategy';
import type { TechnicalTimeframe, UpstoxInstrument } from './technical';

export type ShadowOutcomeStatus = 'pending' | 'triggered' | 'target' | 'stop' | 'time_exit' | 'expired' | 'invalidated' | 'rejected';

export interface StrategySignalSetup {
  status: string;
  releaseStatus: 'research' | 'shadow' | 'validated';
  rulesQualified: boolean;
  shadowTrackable: boolean;
  eligible: boolean;
  entry: StrategyEntryPlan | null;
  stop: StrategyStopPlan | null;
  targets: StrategyTarget[];
  costs: TradingCostEstimate | null;
  gates: StrategyGate[];
  audit: StrategyEvaluation['audit'];
  expiry: string | null;
  maximumHoldingBars: number;
}

export interface StrategySignalSnapshot {
  currentPrice: number;
  marketDataStatus: string;
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  lastCandleAt: string | null;
  validation?: Record<string, unknown>;
  marketRegime: MarketRegimeAnalysis;
  sectorStrength: SectorStrengthAnalysis;
  stockStrength: StockStrengthAnalysis;
}

export interface StrategySignalRecord {
  id: string;
  instrumentKey: string;
  ticker: string;
  exchange: string;
  strategyId: string;
  strategyVersion: string;
  decisionStatus: string;
  mode: 'shadow' | 'research';
  marketTimestamp: string;
  detectedAt: string;
  setup: StrategySignalSetup;
  snapshot: StrategySignalSnapshot;
  outcomeStatus: ShadowOutcomeStatus;
  outcome?: Record<string, unknown> | null;
  closedAt?: string | null;
}

export interface TradeJournalRecord {
  id: string;
  signalId?: string | null;
  instrumentKey: string;
  ticker: string;
  strategyId?: string | null;
  strategyVersion?: string | null;
  actualEntry: number;
  actualExit?: number | null;
  quantity: number;
  actualCharges?: number | null;
  realizedPnl?: number | null;
  entryAt: string;
  exitAt?: string | null;
  notes?: string | null;
  userConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}
