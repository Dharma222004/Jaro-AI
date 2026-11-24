import type { QtvtHorizon, QtvtSizingPlan, QtvtRrPlan, QtvtTranchePlan } from '@/types/qtvt';

export interface SolverParams {
  cmp: number;
  stopPrice: number;
  target1: number;
  target2: number;
  target3: number;
  zoneLow: number;
  zoneHigh: number;
  horizon: QtvtHorizon;
  averageVolume20d?: number | null;
  portfolioCapital?: number;
  riskPct?: number;
  vixElevated?: boolean;
  eventEstimated?: boolean;
}

export interface SolverResult {
  rr: QtvtRrPlan;
  chaseLimit: number;
  alertPrice: number;
  costs: {
    roundTripBps: number;
    perShareCost: number;
  };
  sizing: QtvtSizingPlan;
}

/**
 * Deterministic Entry-Price Solver (Section 11)
 * E_max = (T + k * S) / (1 + k) - c
 */
export function solveEntryAndSizing(params: SolverParams): SolverResult {
  const {
    cmp,
    stopPrice,
    target1,
    target2,
    target3,
    zoneLow,
    zoneHigh,
    horizon,
    averageVolume20d,
    vixElevated = false,
    eventEstimated = false,
  } = params;

  // Round-trip statutory and execution cost (Brokerage, STT 0.1%, GST, stamp duty, slippage)
  // Estimated ~25 bps (0.25%) round-trip
  const roundTripBps = 25;
  const perShareCost = Math.round(((cmp * roundTripBps) / 10000) * 100) / 100;

  // Required min Net R/R to Target 1
  const requiredMinR = horizon === 'SWING' ? 1.2 : 1.5;

  // Compute E_max for Target 1:
  // (T1 - E - c) / (E - S + c) >= k => E_max = (T1 + k * S) / (1 + k) - c
  const k = requiredMinR;
  const rawChaseLimit = (target1 + k * stopPrice) / (1 + k) - perShareCost;
  const chaseLimit = Math.round(rawChaseLimit * 10) / 10;

  // Alert price: trigger alert when price pulls back into the viable zone or at chase limit
  const alertPrice = Math.min(zoneHigh, Math.max(zoneLow, chaseLimit));

  // Compute R/R at CMP, zone midpoint, and chase limit
  const zoneMid = Math.round(((zoneLow + zoneHigh) / 2) * 10) / 10;

  const netR = (entry: number, target: number) => {
    const risk = entry - stopPrice + perShareCost;
    if (risk <= 0) return 0;
    const reward = target - entry - perShareCost;
    return Math.round((reward / risk) * 100) / 100;
  };

  const blendedR = (entry: number) => {
    const r1 = netR(entry, target1);
    const r2 = netR(entry, target2);
    const r3 = netR(entry, target3);
    // Multi-target blended expected R = 0.4*R1 + 0.3*R2 + 0.3*R3 (Section 11)
    return Math.round((0.4 * r1 + 0.3 * r2 + 0.3 * r3) * 100) / 100;
  };

  const rrAtCmp = netR(cmp, target1);
  const rrAtZoneMid = netR(zoneMid, target1);
  const rrAtChaseLimit = netR(chaseLimit, target1);
  const blendedNetAtCmp = blendedR(cmp);

  // Position Sizing: Risk budget and portfolio caps (Section 11)
  const capital = params.portfolioCapital ?? 10_00_000;
  let baseRiskPct = horizon === 'SWING' ? 0.75 : 0.5; // 0.75% for swing, 0.5% for position

  // Halve size for elevated VIX or ESTIMATED event dates (Section 11)
  const sizeHalvedReasons: string[] = [];
  if (vixElevated) {
    baseRiskPct = baseRiskPct * 0.5;
    sizeHalvedReasons.push('Elevated INDIA VIX');
  }
  if (eventEstimated) {
    baseRiskPct = baseRiskPct * 0.5;
    sizeHalvedReasons.push('Unverified / estimated results date');
  }

  const riskBudgetPct = params.riskPct ?? Math.round(baseRiskPct * 100) / 100;
  const maxRiskAmount = Math.round((capital * riskBudgetPct) / 100);

  // Use zoneMid for sizing if CMP is extended, otherwise use CMP
  const sizingEntry = cmp <= chaseLimit ? cmp : zoneMid;
  const riskPerShare = Math.max(1, sizingEntry - stopPrice + perShareCost);

  const rawShares = Math.floor(maxRiskAmount / riskPerShare);

  // Portfolio Cap: max 10% in single stock (SWING) or 7% at full build (POSITION)
  const portfolioCapPct = horizon === 'SWING' ? 0.10 : 0.07;
  const maxPositionValue = capital * portfolioCapPct;
  const maxCapShares = Math.floor(maxPositionValue / sizingEntry);

  // Volume Cap: max 2% of 20-day median daily volume
  const volumeCapShares = averageVolume20d && averageVolume20d > 0
    ? Math.floor(averageVolume20d * 0.02)
    : 999_999;

  const capsApplied: string[] = [];
  let finalShares = rawShares;

  if (finalShares > maxCapShares) {
    finalShares = maxCapShares;
    capsApplied.push(`Single-stock exposure capped at ${Math.round(portfolioCapPct * 100)}% of portfolio capital`);
  }

  if (finalShares > volumeCapShares) {
    finalShares = volumeCapShares;
    capsApplied.push('Position capped at 2% of 20-day median daily volume for liquidity preservation');
  }

  if (sizeHalvedReasons.length > 0) {
    capsApplied.push(`Risk budget halved due to: ${sizeHalvedReasons.join(', ')}`);
  }

  finalShares = Math.max(0, finalShares);
  const positionValue = Math.round(finalShares * sizingEntry);
  const portfolioPct = Math.round((positionValue / capital) * 1000) / 10;

  // Staged Accumulation Tranches for POSITION profile (Section 8 Setup C)
  let tranches: QtvtTranchePlan[] | undefined = undefined;
  if (horizon === 'POSITION') {
    const t1Shares = Math.floor(finalShares * 0.4);
    const t2Shares = Math.floor(finalShares * 0.3);
    const t3Shares = finalShares - t1Shares - t2Shares;

    tranches = [
      {
        trancheNumber: 1,
        allocationPct: 40,
        condition: 'Weekly trend confirmed & FQS >= 70 (Initial tranche)',
        shares: t1Shares,
        capital: Math.round(t1Shares * sizingEntry),
      },
      {
        trancheNumber: 2,
        allocationPct: 30,
        condition: 'Pullback to 40-week MA / 200-day zone (Valuation percentile <= 40)',
        shares: t2Shares,
        capital: Math.round(t2Shares * sizingEntry),
      },
      {
        trancheNumber: 3,
        allocationPct: 30,
        condition: 'Quarterly result confirms earnings thesis, or breakout to new highs (No buying below stop)',
        shares: t3Shares,
        capital: Math.round(t3Shares * sizingEntry),
      },
    ];
  }

  const notes = capsApplied.length
    ? `Sizing constrained: ${capsApplied.join('; ')}.`
    : `Sized strictly by risk capital: ₹${maxRiskAmount.toLocaleString('en-IN')} risk budget (${riskBudgetPct}% of account).`;

  return {
    rr: {
      at_cmp: rrAtCmp,
      at_zone_mid: rrAtZoneMid,
      at_chase_limit: rrAtChaseLimit,
      blended_net: blendedNetAtCmp,
      required_min: requiredMinR,
    },
    chaseLimit,
    alertPrice,
    costs: {
      roundTripBps,
      perShareCost,
    },
    sizing: {
      risk_budget_pct: riskBudgetPct,
      max_risk_amount: maxRiskAmount,
      shares: finalShares,
      position_value: positionValue,
      portfolio_pct: portfolioPct,
      caps_applied: capsApplied,
      notes,
      tranches,
    },
  };
}
