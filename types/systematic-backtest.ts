import type { StrategyId } from './strategy';
import type { TechnicalTimeframe, UpstoxInstrument } from './technical';

export interface SystematicBacktestTrade {
  signalAt: string;
  enteredAt: string;
  exitedAt: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  exitReason: 'stop' | 'target' | 'time';
  grossReturnPct: number;
  netReturnPct: number;
  rMultiple: number;
  holdingBars: number;
  regime: 'bull' | 'bear' | 'sideways';
}

export interface SystematicBacktestMetrics {
  trades: number;
  winRatePct: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  expectancyPct: number | null;
  averageR: number | null;
  profitFactor: number | null;
  maximumDrawdownPct: number | null;
  drawdownDurationTrades: number;
  annualizedReturnPct: number | null;
  volatilityPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  turnover: number | null;
  exposurePct: number | null;
  maximumConsecutiveLosses: number;
}

export interface WalkForwardFold {
  fold: number;
  trainingWindow: { from: string; to: string; candles: number };
  testWindow: { from: string; to: string; candles: number };
  metrics: SystematicBacktestMetrics;
}

export interface SystematicBacktestResult {
  strategyId: StrategyId;
  strategyVersion: string;
  instrument: UpstoxInstrument;
  benchmark: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  generatedAt: string;
  coverage: { from: string | null; to: string | null; candles: number };
  strategyParameters: {
    releaseStatus: 'research' | 'shadow' | 'validated';
    pivotWindow: number;
    minimumDailyTradedValueCr: number;
    minimumNetRewardRisk: number;
    maximumEntryExtensionAtr: number;
    stopAtrMultiplier: number;
    entryBufferAtr: number;
    targetRiskMultiples: number[];
    confirmationVolumeRatio: number;
  };
  assumptions: {
    signalAtCloseEntryAtNextOpen: true;
    buyCostBps: number;
    sellCostBps: number;
    slippageBpsPerSide: number;
    maximumHoldingBars: number;
    sameBarStopBeforeTarget: true;
  };
  training: SystematicBacktestMetrics;
  validation: SystematicBacktestMetrics;
  outOfSample: SystematicBacktestMetrics;
  walkForward: WalkForwardFold[];
  overall: SystematicBacktestMetrics;
  byRegime: Record<'bull' | 'bear' | 'sideways', SystematicBacktestMetrics>;
  byYear: Record<string, SystematicBacktestMetrics>;
  costSensitivity: Array<{ costMultiplier: number; expectancyPct: number | null; profitFactor: number | null }>;
  parameterSensitivity: Array<{ variant: string; trades: number; expectancyPct: number | null; profitFactor: number | null }>;
  trades: SystematicBacktestTrade[];
  warnings: string[];
}
