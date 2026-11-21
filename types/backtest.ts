import type { TechnicalTimeframe, UpstoxInstrument } from './technical';

export interface BacktestTrade {
  entryAt: string;
  exitAt: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  returnPct: number;
  result: 'target' | 'stop' | 'time-exit';
  regime: 'bull' | 'bear' | 'sideways';
}

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  averageReturnPct: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  maximumDrawdownPct: number | null;
  profitFactor: number | null;
  averageRealizedRiskReward: number | null;
}

export interface BacktestResult {
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  methodology: string[];
  assumptions: {
    initialCapital: number;
    brokerageAndChargesBpsPerSide: number;
    slippageBpsPerSide: number;
    maximumHoldingBars: number;
  };
  coverage: { from: string; to: string; candles: number };
  inSample: BacktestMetrics;
  outOfSample: BacktestMetrics;
  overall: BacktestMetrics;
  regimePerformance: Record<'bull' | 'bear' | 'sideways', BacktestMetrics>;
  trades: BacktestTrade[];
  warnings: string[];
  generatedAt: string;
}
