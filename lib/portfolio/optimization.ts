import {
  DEFAULT_PORTFOLIO_RISK_BUDGET,
  PORTFOLIO_OPTIMIZATION_POLICY_VERSION,
} from '@/types/portfolio';
import type {
  OptimizedPosition,
  PortfolioOptimizationInput,
  PortfolioOptimizationResult,
} from '@/types/portfolio';
import { correlationClusters, maxCorrelationForInstrument } from './correlation';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(value: number, total: number): number {
  return total <= 0 ? 0 : round2((value / total) * 100);
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Risk-parity style position sizing: allocate equal risk budget per position,
 * then scale down for correlation clusters, sector caps, and single-position caps.
 */
export function optimizePortfolio(input: PortfolioOptimizationInput): PortfolioOptimizationResult {
  const {
    positions,
    availableCapital,
    accountEquity,
    riskBudget = DEFAULT_PORTFOLIO_RISK_BUDGET,
    correlations = [],
    currentDailyLoss = 0,
    currentConsecutiveLosses = 0,
    cooldownActive = false,
  } = input;

  const policyVersion = PORTFOLIO_OPTIMIZATION_POLICY_VERSION;
  const warnings: string[] = [];
  const blockedPositions: OptimizedPosition[] = [];
  const optimized: OptimizedPosition[] = [];

  // Global policy blocks
  if (cooldownActive) {
    warnings.push('Trading cooldown is active; no new positions are recommended.');
  }
  if (currentConsecutiveLosses != null && currentConsecutiveLosses >= 3) {
    warnings.push(`Current consecutive losses (${currentConsecutiveLosses}) suggest reducing new position sizes.`);
  }
  if (currentDailyLoss != null && riskBudget.maxDailyLossPct != null) {
    const dailyLossPct = (currentDailyLoss / accountEquity) * 100;
    if (dailyLossPct >= riskBudget.maxDailyLossPct) {
      warnings.push(`Daily loss limit (${riskBudget.maxDailyLossPct}%) is reached; no new risk should be added today.`);
    }
  }

  // Correlation clusters
  const clusters = correlationClusters(positions, correlations, 0.6);
  const highCorrelationClusters = clusters.filter((c) => c.length > 1);
  if (highCorrelationClusters.length) {
    warnings.push(
      `${highCorrelationClusters.length} high-correlation cluster(s) detected; correlated positions are sized down jointly.`,
    );
  }

  // Equal risk budget per uncorrelated position
  const effectivePositionCount = Math.max(1, positions.length - highCorrelationClusters.length * 0.5);
  const baseRiskPerPositionPct = clampPct(100 / effectivePositionCount);

  // Sector exposure tracking
  const sectorExposure = new Map<string, number>();
  for (const position of positions) {
    sectorExposure.set(position.sector, (sectorExposure.get(position.sector) || 0) + position.weightPct);
  }

  let deployedCapital = 0;
  let totalRiskPct = 0;
  let maxCorrelation = 0;

  for (const position of positions) {
    const blockedReasons: string[] = [];
    const rationale: string[] = [];
    let correlationAdjusted = false;

    // Cooldown / loss-block
    if (cooldownActive) {
      blockedReasons.push('Trading cooldown is active.');
    }
    if (currentDailyLoss != null && riskBudget.maxDailyLossPct != null) {
      const dailyLossPct = (currentDailyLoss / accountEquity) * 100;
      if (dailyLossPct >= riskBudget.maxDailyLossPct) {
        blockedReasons.push(`Daily loss limit reached (${dailyLossPct.toFixed(1)}% of equity).`);
      }
    }

    // Single position cap
    const singleCap = clampPct(riskBudget.maxSinglePositionPct);
    const sectorCap = clampPct(riskBudget.maxSectorExposurePct);
    const currentSectorExposure = sectorExposure.get(position.sector) || 0;

    // Correlation adjustment
    const instrumentMaxCorr = maxCorrelationForInstrument(position.instrumentKey, correlations);
    maxCorrelation = Math.max(maxCorrelation, instrumentMaxCorr);
    let sizeMultiplier = 1;
    if (instrumentMaxCorr > 0.6) {
      correlationAdjusted = true;
      sizeMultiplier = Math.max(0.4, 1 - (instrumentMaxCorr - 0.6));
      rationale.push(`Correlation-adjusted by ${((1 - sizeMultiplier) * 100).toFixed(0)}% due to ${(instrumentMaxCorr * 100).toFixed(0)}% max pairwise correlation.`);
    }

    // Base weight: equal risk, scaled by correlation
    let targetWeightPct = clampPct(baseRiskPerPositionPct * sizeMultiplier);

    // Single-position cap
    if (targetWeightPct > singleCap) {
      targetWeightPct = singleCap;
      rationale.push(`Capped to single-position limit of ${singleCap}%.`);
    }

    // Sector cap
    const roomInSector = Math.max(0, sectorCap - currentSectorExposure);
    if (targetWeightPct > roomInSector) {
      targetWeightPct = roomInSector;
      rationale.push(`Capped to remaining sector exposure of ${roomInSector.toFixed(1)}%.`);
    }

    if (targetWeightPct <= 0) {
      blockedPositions.push({
        instrumentKey: position.instrumentKey,
        ticker: position.ticker,
        sector: position.sector,
        suggestedQuantity: 0,
        suggestedEntry: position.currentPrice,
        suggestedStop: position.stopLoss ?? position.currentPrice * 0.95,
        suggestedTarget: position.target ?? null,
        weightPct: 0,
        riskAmount: 0,
        riskContributionPct: 0,
        correlationAdjusted,
        blocked: true,
        blockedReasons: blockedReasons.length ? blockedReasons : ['No exposure capacity under current policy.'],
        rationale,
      });
      continue;
    }

    const suggestedCapital = (accountEquity * targetWeightPct) / 100;
    const entryPrice = position.currentPrice;
    const stopPrice = position.stopLoss ?? entryPrice * 0.95;
    const riskPerShare = Math.max(entryPrice - stopPrice, 0.01);
    const riskAmount = suggestedCapital * (riskPerShare / entryPrice);
    const riskContributionPct = (riskAmount / accountEquity) * 100;

    totalRiskPct += riskContributionPct;
    deployedCapital += suggestedCapital;

    sectorExposure.set(position.sector, currentSectorExposure + targetWeightPct);

    optimized.push({
      instrumentKey: position.instrumentKey,
      ticker: position.ticker,
      sector: position.sector,
      suggestedQuantity: Math.floor(suggestedCapital / entryPrice),
      suggestedEntry: round2(entryPrice),
      suggestedStop: round2(stopPrice),
      suggestedTarget: position.target != null ? round2(position.target) : null,
      weightPct: round2(targetWeightPct),
      riskAmount: round2(riskAmount),
      riskContributionPct: round2(riskContributionPct),
      correlationAdjusted,
      blocked: false,
      blockedReasons: [],
      rationale,
    });
  }

  // Sort by risk contribution descending
  optimized.sort((a, b) => b.riskContributionPct - a.riskContributionPct);

  const totalExposurePct = pct(deployedCapital, accountEquity);
  const diversificationScore = Math.round(
    Math.max(0, 100 - maxCorrelation * 50 - (optimized.length > 0 ? 0 : 100)),
  );

  return {
    totalCapital: round2(accountEquity),
    deployedCapital: round2(deployedCapital),
    availableCapital: round2(availableCapital),
    totalExposurePct: round2(totalExposurePct),
    totalRiskPct: round2(totalRiskPct),
    positions: optimized,
    warnings,
    blockedPositions,
    diversificationScore,
    maxCorrelation: round2(maxCorrelation * 100),
    generatedAt: new Date().toISOString(),
    policyVersion,
  };
}
