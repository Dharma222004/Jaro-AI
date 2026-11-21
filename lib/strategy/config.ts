import type { StrategyId } from '@/types/strategy';

export interface StrategyConfiguration {
  id: StrategyId;
  version: string;
  releaseStatus: 'research' | 'shadow' | 'validated';
  pivotWindow: number;
  minimumDailyTradedValueCr: number;
  minimumNetRewardRisk: number;
  maximumEntryExtensionAtr: number;
  stopAtrMultiplier: number;
  entryBufferAtr: number;
  targetRiskMultiples: number[];
  maximumHoldingBars: number;
  confirmationVolumeRatio: number;
  buyCostBps: number;
  sellCostBps: number;
  slippageBpsPerSide: number;
}

export const STRATEGY_CONFIGS: Record<StrategyId, StrategyConfiguration> = {
  trend_pullback_continuation: {
    id: 'trend_pullback_continuation',
    version: 'TPC-1.0.0',
    releaseStatus: 'shadow',
    pivotWindow: 2,
    minimumDailyTradedValueCr: 5,
    minimumNetRewardRisk: 1.5,
    maximumEntryExtensionAtr: 0.45,
    stopAtrMultiplier: 0.6,
    entryBufferAtr: 0.2,
    targetRiskMultiples: [1.8, 2.5],
    maximumHoldingBars: 30,
    confirmationVolumeRatio: 0.8,
    buyCostBps: 12,
    sellCostBps: 12,
    slippageBpsPerSide: 10,
  },
  breakout_retest: {
    id: 'breakout_retest',
    version: 'BRT-1.0.0',
    releaseStatus: 'shadow',
    pivotWindow: 2,
    minimumDailyTradedValueCr: 8,
    minimumNetRewardRisk: 1.7,
    maximumEntryExtensionAtr: 0.75,
    stopAtrMultiplier: 0.5,
    entryBufferAtr: 0.15,
    targetRiskMultiples: [2.0, 2.7],
    maximumHoldingBars: 25,
    confirmationVolumeRatio: 1.35,
    buyCostBps: 12,
    sellCostBps: 12,
    slippageBpsPerSide: 12,
  },
};

export const STRATEGY_POLICY_VERSION = 'JARO-SYSTEMATIC-1.0.0';

export const POSITION_SIZING_POLICY = {
  version: 'JARO-SIZING-1.0.0',
  maximumAverageDailyValueParticipationPct: 0.5,
} as const;
