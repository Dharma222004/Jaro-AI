// lib/screener/evaluator.ts
// Deterministic FilterEvaluator and ResultRankingEngine.
// Missing or unavailable fields NEVER pass a mandatory condition.

import type {
  ConditionEvaluation,
  ScreenerCandidateRow,
  ScreenerCondition,
  ScreenerField,
  ScreenerSortField,
  ScreenerSpec,
} from '@/types/screener';

function resolveFieldValue(row: ScreenerCandidateRow, field: ScreenerField): number | null {
  switch (field) {
    case 'daily_close': return row.price;
    case 'daily_volume': return row.dailyVolumeShares;
    case 'intraday_volume': return row.dailyVolumeShares;
    case 'avg_volume_5d': return row.avgVolume5d;
    case 'avg_volume_20d': return row.avgVolume20d;
    case 'avg_volume_50d': return row.avgVolume50d;
    case 'relative_volume': return row.relativeVolume;
    case 'daily_turnover_cr': return row.dailyTurnoverCr;
    case 'market_cap_cr': return row.marketCapCr;
    case 'sma_5': return row.sma5;
    case 'sma_10': return row.sma10;
    case 'sma_20': return row.sma20;
    case 'sma_50': return row.sma50;
    case 'sma_100': return row.sma100;
    case 'sma_200': return row.sma200;
    case 'ema_9': return row.ema9;
    case 'ema_20': return row.ema20;
    case 'ema_50': return row.ema50;
    case 'ema_100': return row.ema100;
    case 'ema_200': return row.ema200;
    case 'diff_from_sma_50_pct': return row.diffFromSma50Pct;
    case 'rsi_14': return row.rsi14;
    case 'macd_above_signal':
      return row.macd != null && row.macdSignal != null ? (row.macd > row.macdSignal ? 1 : 0) : null;
    case 'macd_bullish_crossover':
      return row.macd != null && row.macdSignal != null && row.macdHistogram != null
        ? (row.macd > row.macdSignal && row.macdHistogram > 0 ? 1 : 0)
        : null;
    case 'stochastic_k': return row.stochasticK;
    case 'atr_pct': return row.atrPct;
    case 'bb_width_pct': return row.bbWidthPct;
    case 'bb_contraction':
      return row.bbWidthPct != null ? (row.bbWidthPct <= 8 ? 1 : 0) : null;
    case 'near_52w_high':
      return row.distanceFrom52WeekHighPct != null ? (row.distanceFrom52WeekHighPct <= 5 ? 1 : 0) : null;
    case 'near_52w_low':
      return row.distanceFrom52WeekLowPct != null ? (row.distanceFrom52WeekLowPct <= 10 ? 1 : 0) : null;
    case 'breakout_52w_high':
      return row.high52W != null ? (row.price >= row.high52W * 0.995 ? 1 : 0) : null;
    case 'distance_from_52w_high_pct': return row.distanceFrom52WeekHighPct;
    case 'distance_from_52w_low_pct': return row.distanceFrom52WeekLowPct;
    case 'higher_highs_lows':
      return row.higherHighsLows == null ? null : (row.higherHighsLows ? 1 : 0);
    case 'support_retest':
      return row.supportLevel != null && row.price > 0
        ? (Math.abs((row.price - row.supportLevel) / row.price) <= 0.03 ? 1 : 0)
        : null;
    case 'resistance_breakout':
      return row.resistanceLevel != null ? (row.price > row.resistanceLevel ? 1 : 0) : null;
    case 'roe_pct': return row.roePct;
    case 'roce_pct': return row.rocePct;
    case 'roa_pct': return row.roaPct;
    case 'gross_margin_pct': return row.grossMarginPct;
    case 'ebitda_margin_pct': return row.ebitdaMarginPct;
    case 'operating_margin_pct': return row.operatingMarginPct;
    case 'net_margin_pct': return row.netMarginPct;
    case 'revenue_growth_pct': return row.revenueGrowthPct;
    case 'operating_profit_growth_pct': return row.operatingProfitGrowthPct;
    case 'net_profit_growth_pct': return row.netProfitGrowthPct;
    case 'eps_growth_pct': return row.epsGrowthPct;
    case 'cagr_3y_pct': return row.cagr3yPct;
    case 'cagr_5y_pct': return row.cagr5yPct;
    case 'debt_to_equity': return row.debtToEquity;
    case 'current_ratio': return row.currentRatio;
    case 'interest_coverage': return row.interestCoverage;
    case 'operating_cash_flow_cr': return row.operatingCashFlowCr;
    case 'free_cash_flow_cr': return row.freeCashFlowCr;
    case 'net_debt_cr': return row.netDebtCr;
    case 'pe': return row.pe;
    case 'pb': return row.pb;
    case 'ev_to_ebitda': return row.evToEbitda;
    case 'peg': return row.peg;
    case 'dividend_yield_pct': return row.dividendYieldPct;
    case 'promoter_holding_pct': return row.promoterHoldingPct;
    case 'promoter_pledge_pct': return row.promoterPledgePct;
    case 'fii_holding_pct': return row.fiiHoldingPct;
    case 'dii_holding_pct': return row.diiHoldingPct;
    default: return null;
  }
}

function formatMetricDisplay(field: ScreenerField, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  if (field === 'market_cap_cr' || field === 'daily_turnover_cr' || field === 'operating_cash_flow_cr' || field === 'free_cash_flow_cr' || field === 'net_debt_cr') {
    return `₹${Math.round(value).toLocaleString('en-IN')} Cr`;
  }
  if (field.includes('volume') && field !== 'relative_volume') {
    return `${Math.round(value).toLocaleString('en-IN')} shares`;
  }
  if (field.includes('pct')) return `${value.toFixed(2)}%`;
  return value.toFixed(2);
}

export function evaluateSingleCondition(row: ScreenerCandidateRow, cond: ScreenerCondition): ConditionEvaluation {
  const lhs = resolveFieldValue(row, cond.field);
  if (lhs == null || !Number.isFinite(lhs)) {
    return {
      conditionId: cond.id,
      label: cond.label,
      passed: 'unavailable',
      actualDisplay: 'Unavailable',
      reason: `${cond.field} unavailable`,
    };
  }

  let rhs: number | null = cond.value ?? null;
  if (cond.referenceField) {
    rhs = resolveFieldValue(row, cond.referenceField);
    if (rhs == null || !Number.isFinite(rhs)) {
      return {
        conditionId: cond.id,
        label: cond.label,
        passed: 'unavailable',
        actualDisplay: `${formatMetricDisplay(cond.field, lhs)} vs Unavailable`,
        reason: `${cond.referenceField} unavailable`,
      };
    }
  }

  if (cond.operator === 'crosses_above' && cond.referenceField === 'sma_50') {
    const passed = rhs != null && lhs > rhs && row.prevCloseBelowSma50 === true;
    return {
      conditionId: cond.id,
      label: cond.label,
      passed: row.prevCloseBelowSma50 == null ? 'unavailable' : passed,
      actualDisplay: `${formatMetricDisplay(cond.field, lhs)} vs ${formatMetricDisplay(cond.referenceField, rhs)}`,
      reason: row.prevCloseBelowSma50 == null ? 'Prior-session SMA 50 history unavailable' : undefined,
    };
  }

  if (cond.operator === 'crosses_below' && cond.referenceField === 'sma_50') {
    const passed = rhs != null && lhs < rhs && row.prevCloseBelowSma50 === false;
    return {
      conditionId: cond.id,
      label: cond.label,
      passed: row.prevCloseBelowSma50 == null ? 'unavailable' : passed,
      actualDisplay: `${formatMetricDisplay(cond.field, lhs)} vs ${formatMetricDisplay(cond.referenceField, rhs)}`,
      reason: row.prevCloseBelowSma50 == null ? 'Prior-session SMA 50 history unavailable' : undefined,
    };
  }

  if (rhs == null) {
    return {
      conditionId: cond.id,
      label: cond.label,
      passed: 'unavailable',
      actualDisplay: formatMetricDisplay(cond.field, lhs),
      reason: 'Missing comparison threshold',
    };
  }

  let passed = false;
  switch (cond.operator) {
    case '>': passed = lhs > rhs; break;
    case '>=': passed = lhs >= rhs; break;
    case '<': passed = lhs < rhs; break;
    case '<=': passed = lhs <= rhs; break;
    case '=': passed = Math.abs(lhs - rhs) < 1e-6; break;
    case 'between':
      passed = cond.valueTo != null ? lhs >= rhs && lhs <= cond.valueTo : false;
      break;
    default:
      passed = lhs > rhs;
  }

  const actualDisplay = cond.referenceField
    ? `${formatMetricDisplay(cond.field, lhs)} vs ${formatMetricDisplay(cond.referenceField, rhs)}`
    : formatMetricDisplay(cond.field, lhs);

  return {
    conditionId: cond.id,
    label: cond.label,
    passed,
    actualDisplay,
    reason: passed ? undefined : `Failed ${cond.label} (${actualDisplay})`,
  };
}

export function evaluateScreenerCandidates(
  candidates: ScreenerCandidateRow[],
  spec: ScreenerSpec,
): {
  matched: ScreenerCandidateRow[];
  evaluated: ScreenerCandidateRow[];
  unavailableCount: number;
  exclusionReasons: Record<string, number>;
} {
  const exclusionReasons: Record<string, number> = {};
  let unavailableCount = 0;

  const evaluated = candidates.map((row) => {
    const conditionResults = spec.conditions.map((cond) => evaluateSingleCondition(row, cond));
    const missingData = conditionResults.filter((r) => r.passed === 'unavailable').map((r) => r.reason ?? r.label);

    let sectorPass = true;
    if (spec.sector) {
      const sLower = spec.sector.toLowerCase();
      sectorPass = Boolean(row.sector?.toLowerCase().includes(sLower) || row.industry?.toLowerCase().includes(sLower));
      if (!sectorPass) missingData.push(`Sector mismatch (${row.sector ?? 'Unknown'})`);
    }

    let matched = false;
    if (spec.conditions.length === 0) {
      matched = sectorPass;
    } else if (spec.logicalOperator === 'OR') {
      matched = sectorPass && conditionResults.some((r) => r.passed === true);
    } else {
      matched = sectorPass && conditionResults.every((r) => r.passed === true);
    }

    let exclusionReason: string | undefined;
    if (!matched) {
      if (missingData.length > 0 && conditionResults.some((r) => r.passed === 'unavailable')) {
        unavailableCount += 1;
        exclusionReason = missingData[0];
      } else if (!sectorPass) {
        exclusionReason = `Sector filter (${spec.sector})`;
      } else {
        const failedCond = conditionResults.find((r) => r.passed === false);
        exclusionReason = failedCond?.reason ?? 'Did not match filter criteria';
      }
      exclusionReasons[exclusionReason] = (exclusionReasons[exclusionReason] ?? 0) + 1;
    }

    return {
      ...row,
      conditionResults,
      matched,
      missingData,
      exclusionReason,
    };
  });

  const matched = rankScreenerResults(evaluated.filter((r) => r.matched), spec);

  return {
    matched: matched.slice(0, spec.limit),
    evaluated,
    unavailableCount,
    exclusionReasons,
  };
}

function resolveSortValue(row: ScreenerCandidateRow, field: ScreenerSortField): number | null {
  switch (field) {
    case 'market_cap_cr': return row.marketCapCr;
    case 'daily_volume': return row.dailyVolumeShares;
    case 'price': return row.price;
    case 'daily_turnover_cr': return row.dailyTurnoverCr;
    case 'relative_volume': return row.relativeVolume;
    case 'roce_pct': return row.rocePct;
    case 'roe_pct': return row.roePct;
    case 'revenue_growth_pct': return row.revenueGrowthPct;
    case 'net_profit_growth_pct': return row.netProfitGrowthPct;
    case 'rsi_14': return row.rsi14;
    case 'diff_from_sma_50_pct': return row.diffFromSma50Pct;
    case 'pe': return row.pe;
    default: return row.marketCapCr;
  }
}

export function rankScreenerResults(rows: ScreenerCandidateRow[], spec: ScreenerSpec): ScreenerCandidateRow[] {
  const dir = spec.sortOrder === 'ASC' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = resolveSortValue(a, spec.sortBy);
    const vb = resolveSortValue(b, spec.sortBy);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir;
  });
}
