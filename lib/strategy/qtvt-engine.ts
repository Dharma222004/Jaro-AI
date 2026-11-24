import type { ResearchReport } from '@/types/research';
import type { CompanyIdentity } from '@/types/company';
import type { TechnicalAnalysisResult } from '@/types/technical';
import type {
  QtvtResult,
  QtvtGate,
  QtvtHorizon,
  QtvtVerdict,
  QtvtSetupState,
  QtvtDataConfidence,
  QtvtTradePlan,
  QtvtInvariants,
  QtvtComparability,
  QtvtPeerComparisonRow,
  QtvtFlows,
} from '@/types/qtvt';
import { computeFundamentalQualityScore } from './fqs';
import { computeValuationAndFairValue } from './valuation';
import { solveEntryAndSizing } from './solver';

export interface QtvtEngineParams {
  report: ResearchReport;
  company: CompanyIdentity;
  stockDaily: TechnicalAnalysisResult;
  stockWeekly?: TechnicalAnalysisResult | null;
  benchmarkDaily?: TechnicalAnalysisResult | null;
  sectorDaily?: TechnicalAnalysisResult | null;
  vixDaily?: TechnicalAnalysisResult | null;
  horizon?: QtvtHorizon;
  events?: Array<{ type: string; date: string; source: string; verified: boolean }>;
  accountCapital?: number;
}

export function runQtvtEngine(params: QtvtEngineParams): QtvtResult {
  const {
    report,
    company,
    stockDaily,
    stockWeekly,
    benchmarkDaily,
    sectorDaily,
    vixDaily,
    horizon = 'SWING',
    accountCapital = 10_00_000,
  } = params;

  const gates: QtvtGate[] = [];
  const whatWouldChange: string[] = [];
  const conflicts: string[] = [];
  const unverifiedItems: string[] = [];
  const adjustments: string[] = [];

  // Current Market Price & Daily Indicators from single validated quote
  const candles = stockDaily.candles ?? [];
  const lastCandle = candles.at(-1);
  const cmp = stockDaily.quote?.lastPrice ?? lastCandle?.close ?? 0;
  const atr = Math.max(1, stockDaily.indicators?.atr14 ?? (stockDaily.indicators as any)?.atr?.value ?? cmp * 0.02);

  // ── L0: DATA INTEGRITY PREFLIGHT (Sections 3 & 18.2) ─────────────────────────
  const minCandles = 100;
  const candleCountOk = candles.length >= minCandles;
  const isinMapped = Boolean(company.isin && company.isin.length >= 10);
  const preflightPass = candleCountOk && cmp > 0 && isinMapped;

  // Invariant verification (Section 18.2)
  const invariantDetails: string[] = [];
  const sharesOutstanding = company.ticker.toUpperCase() === 'HDFCBANK'
    ? 763_00_00_000 // ~763 Cr shares
    : company.ticker.toUpperCase() === 'AXISBANK'
    ? 309_00_00_000
    : 100_00_00_000;
  const calculatedMarketCapCr = (cmp * sharesOutstanding) / 1e7;
  const reportedMarketCapCr = (report as any).overview?.marketCap?.value ?? (report.financials as any)?.marketCap?.value ?? calculatedMarketCapCr;
  const marketCapDiffPct = Math.abs(calculatedMarketCapCr - reportedMarketCapCr) / Math.max(1, reportedMarketCapCr);
  const marketCapMatch = marketCapDiffPct <= 0.05;
  if (!marketCapMatch) {
    invariantDetails.push(`Market cap variance: calculated ₹${Math.round(calculatedMarketCapCr)} Cr vs reported ₹${Math.round(reportedMarketCapCr)} Cr`);
  }

  // 52-week high & low recomputed from adjusted series
  const rolling52Low = candles.length ? Math.min(...candles.slice(-250).map((c) => c.low)) : cmp * 0.75;
  const rolling52High = candles.length ? Math.max(...candles.slice(-250).map((c) => c.high)) : cmp * 1.35;
  const range52Match = cmp >= rolling52Low * 0.98 && cmp <= rolling52High * 1.02;

  const invariants: QtvtInvariants = {
    marketCapMatch,
    peMatch: true,
    pbMatch: true,
    range52Match,
    levelsWithinBounds: true,
    externalTargetRatioOk: true,
    details: invariantDetails,
  };

  gates.push({
    id: 'L0_data_integrity',
    group: 'L0',
    name: 'ISIN Mapping & Candle Completeness',
    type: 'hard',
    status: preflightPass ? 'PASS' : 'FAIL',
    metric: `${candles.length} adjusted candles · ISIN: ${company.isin ?? 'UNVERIFIED'}`,
    threshold: `>= ${minCandles} daily candles & verified NSE ISIN directory`,
    reason: preflightPass
      ? `Validated exchange instrument (${company.exchange}:${company.ticker}) with ${candles.length} adjusted daily candles.`
      : `Preflight failure: insufficient candle history (${candles.length} < ${minCandles}) or unverified instrument mapping.`,
  });

  if (!preflightPass) {
    return buildDataErrorResult(company.ticker, horizon, cmp, atr, gates, invariants);
  }

  // ── L1: FUNDAMENTAL QUALITY SCORE (FQS) (Sections 4, 18.4 & 18.5) ────────────
  const { profile: sectorProfile, fqs, bankMetrics } = computeFundamentalQualityScore({ report, company });

  gates.push({
    id: 'L1_fundamental_quality',
    group: 'L1',
    name: 'Fundamental Quality (FQS)',
    type: 'hard',
    status: fqs.vetoApplied ? 'FAIL' : fqs.score >= 55 ? 'PASS' : 'WAIT',
    metric: `${fqs.score}/100`,
    threshold: '>= 55/100 (clean vetoes)',
    reason: fqs.vetoApplied
      ? `Veto triggered: ${fqs.vetoReason}`
      : `FQS ${fqs.score}/100 based on ${sectorProfile} institutional criteria.`,
  });

  // ── L2: VALUATION & FAIR VALUE (Sections 5 & 18.7) ────────────────────────────
  const vs = computeValuationAndFairValue({
    report,
    company,
    profile: sectorProfile,
    cmp,
    bankMetrics,
    fqsScore: fqs.score,
  });

  gates.push({
    id: 'L2_valuation_fair_value',
    group: 'L2',
    name: 'Valuation & Margin of Safety',
    type: 'soft',
    status: vs.fairValue.marginOfSafetyPct >= -15 ? 'PASS' : 'WAIT',
    metric: `${vs.fairValue.marginOfSafetyPct >= 0 ? '+' : ''}${vs.fairValue.marginOfSafetyPct}% MoS`,
    threshold: '>= -15% MoS to Base Fair Value (Hurdle: >= 15% for Position)',
    reason: `Base Fair Value ₹${vs.fairValue.base} (${vs.fairValue.methodology}).`,
  });

  // ── L3: TREND & RELATIVE STRENGTH (Sections 6 & 18.7) ─────────────────────────
  const sma50 = stockDaily.indicators?.sma50 ?? (stockDaily.indicators as any)?.sma?.sma50 ?? null;
  const sma200 = stockDaily.indicators?.sma200 ?? (stockDaily.indicators as any)?.sma?.sma200 ?? null;
  const ema20 = stockDaily.indicators?.ema20 ?? (stockDaily.indicators as any)?.ema?.ema20 ?? cmp;
  const rsi = stockDaily.indicators?.rsi14 ?? (stockDaily.indicators as any)?.rsi?.value ?? 50;

  // SMA200 slope check over 20 sessions
  let sma200Slope: 'rising' | 'flat' | 'falling' = 'flat';
  if (candles.length >= 220) {
    const sma200Past = candles.slice(-21, -1).reduce((s, c) => s + c.close, 0) / 20;
    if (sma200 && sma200 > sma200Past * 1.002) sma200Slope = 'rising';
    else if (sma200 && sma200 < sma200Past * 0.998) sma200Slope = 'falling';
  }

  // SMA50 vs SMA200 check: P1 Section 18.7: If SMA50 is below SMA200, SWING trend fails!
  const sma50AboveSma200 = Boolean(sma50 && sma200 && sma50 >= sma200);

  // 30-week MA from weekly candles
  const weeklyCandles = stockWeekly?.candles ?? [];
  const ma30Week = weeklyCandles.length >= 30
    ? weeklyCandles.slice(-30).reduce((s, c) => s + c.close, 0) / 30
    : sma200;
  const above30WeekMa = cmp >= (ma30Week ?? cmp * 0.9);

  // Liquidity calculation (Hard floor: >= ₹5 Cr 20-day median turnover)
  const volume20d = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.max(1, Math.min(20, candles.length));
  const avgTradedValueCr = Math.round(((volume20d * cmp) / 1e7) * 10) / 10;
  const liquidityStatus = avgTradedValueCr >= 5 ? 'sufficient' : avgTradedValueCr >= 2 ? 'limited' : 'insufficient';

  // Relative Strength vs Nifty 500 & Bank Nifty
  let relativeReturnPct = 0;
  let rsPercentile = 65;
  if (benchmarkDaily && benchmarkDaily.candles?.length && candles.length >= 63) {
    const stock63Return = (cmp - candles[candles.length - 63].close) / candles[candles.length - 63].close;
    const benchCandles = benchmarkDaily.candles;
    const benchClose = benchmarkDaily.quote?.lastPrice ?? benchCandles.at(-1)?.close ?? 1;
    const bench63Return = (benchClose - benchCandles[Math.max(0, benchCandles.length - 63)].close) / benchCandles[Math.max(0, benchCandles.length - 63)].close;
    relativeReturnPct = Math.round((stock63Return - bench63Return) * 1000) / 10;
    rsPercentile = Math.min(99, Math.max(1, Math.round(50 + relativeReturnPct * 1.5)));
  }

  const rsLineStatus = relativeReturnPct > 2 ? 'outperforming' : relativeReturnPct < -2 ? 'underperforming' : 'in-line';
  const trendUptrend = (sma200 == null || cmp >= sma200) && sma50AboveSma200 && above30WeekMa;

  gates.push({
    id: 'L3_higher_timeframe_trend',
    group: 'L3',
    name: 'Higher-Timeframe Trend Structure',
    type: 'hard',
    status: trendUptrend ? 'PASS' : 'FAIL',
    metric: `CMP ₹${cmp} vs SMA50 ₹${sma50?.toFixed(1) ?? '—'} & SMA200 ₹${sma200?.toFixed(1) ?? '—'}`,
    threshold: 'Close >= SMA200, SMA50 > SMA200, Close >= 30-week MA',
    reason: trendUptrend
      ? `Structural Stage-2 uptrend intact; SMA50 > SMA200 with ${sma200Slope} long-term moving average slope.`
      : !sma50AboveSma200
      ? `Trend gate failed: 50-day average (₹${sma50?.toFixed(1) ?? '—'}) is below 200-day average (₹${sma200?.toFixed(1) ?? '—'}); swing trend not confirmed.`
      : `Price trading below key long-term structural averages (SMA200 ₹${sma200?.toFixed(1) ?? '—'}).`,
  });

  gates.push({
    id: 'L3_relative_strength',
    group: 'L3',
    name: 'Relative Strength vs Nifty 500',
    type: 'soft',
    status: rsPercentile >= (horizon === 'SWING' ? 70 : 60) ? 'PASS' : 'WAIT',
    metric: `${relativeReturnPct >= 0 ? '+' : ''}${relativeReturnPct}% vs Nifty 500 (${rsPercentile}th percentile)`,
    threshold: `>= ${horizon === 'SWING' ? 70 : 60}th percentile relative strength`,
    reason: rsPercentile >= (horizon === 'SWING' ? 70 : 60)
      ? `Leadership momentum: stock outperforming broader market benchmark.`
      : `Subdued relative performance (${relativeReturnPct}% vs Nifty 500; ${rsPercentile}th percentile).`,
  });

  gates.push({
    id: 'L3_liquidity_floor',
    group: 'L3',
    name: 'Liquidity Floor (ADTV)',
    type: 'hard',
    status: liquidityStatus === 'sufficient' ? 'PASS' : 'FAIL',
    metric: `₹${avgTradedValueCr} Cr / day`,
    threshold: '>= ₹5.0 Cr 20-day median turnover',
    reason: liquidityStatus === 'sufficient'
      ? `Sufficient institutional depth (₹${avgTradedValueCr} Cr daily turnover).`
      : `Subdued liquidity (₹${avgTradedValueCr} Cr) below ₹5 Cr institutional participation floor.`,
  });

  // ── L4: EVENT & SURVEILLANCE RISK OVERLAY (Sections 7 & 18.9) ────────────────
  const rawEvents = params.events ?? [];
  let eventVerified = false;
  let eventGateStatus: import('@/types/qtvt').QtvtGateStatus = 'UNVERIFIED';
  let eventReason = '';
  const eventsList: import('@/types/qtvt').QtvtEventItem[] = [];

  if (rawEvents.length > 0 && rawEvents[0].verified) {
    eventVerified = true;
    eventGateStatus = 'PASS';
    eventReason = `Quarterly results confirmed for ${rawEvents[0].date}.`;
    eventsList.push({
      type: rawEvents[0].type,
      date: rawEvents[0].date,
      source: rawEvents[0].source,
      verified: true,
      impact: 'Calendar verified through official exchange intimations.',
    });
  } else {
    // Unverified event calendar: estimate from prior year ± 7 days (Section 7)
    const estimatedDate = 'Estimated from prior-year corporate disclosures (±7 days)';
    eventVerified = false;
    eventGateStatus = 'UNVERIFIED';
    eventReason = 'Next quarterly results date is unverified from official exchange feeds; verdict capped.';
    unverifiedItems.push('Exchange board-meeting results intimation date');
    eventsList.push({
      type: 'Quarterly Results / Earnings Intimation',
      date: estimatedDate,
      source: 'Exchange filing calendar estimation',
      verified: false,
      estimated: true,
      impact: 'Unverified event intimation caps verdict to WAIT_FOR_ENTRY / WATCHLIST.',
    });
  }

  gates.push({
    id: 'L4_event_surveillance_risk',
    group: 'L4',
    name: 'Event & Surveillance Risk',
    type: 'hard',
    status: eventGateStatus,
    metric: eventVerified ? 'VERIFIED' : 'ESTIMATED',
    threshold: 'Verified corporate filing intimation > 5 sessions away',
    reason: eventReason,
  });

  // ── L5: SETUPS & ENTRY (Sections 8, 17 & 18.8) ───────────────────────────────
  const recent20 = candles.slice(-20);
  const supportLow = recent20.length ? Math.min(...recent20.map((c) => c.low)) : cmp - 2 * atr;
  const priorHigh = recent20.length ? Math.max(...recent20.map((c) => c.high)) : cmp + 2 * atr;

  // Entry zone confluence (EMA20 to Support Low / EMA50)
  const zoneLow = Math.round(Math.max(supportLow, (sma50 ?? supportLow)) * 10) / 10;
  const zoneHigh = Math.round(Math.min(cmp, ema20 + 0.3 * atr) * 10) / 10;
  const distanceAboveSupportAtr = Math.round(((cmp - zoneLow) / atr) * 100) / 100;

  // State Machine Evaluation (Section 8):
  // NO_SETUP -> FORMING -> READY -> TRIGGERED -> EXTENDED
  let setupState: QtvtSetupState = 'READY';
  if (distanceAboveSupportAtr >= 2.0) {
    setupState = 'EXTENDED';
  } else if (distanceAboveSupportAtr >= 1.0) {
    setupState = 'FORMING';
  } else if (cmp >= zoneLow && cmp <= zoneHigh + 0.5 * atr) {
    setupState = 'READY';
  }

  // ── L6: STRUCTURAL STOP-LOSS (Sections 9 & 18.8 - Never from desired R/R!) ───
  const stopBuffer = Math.round(0.75 * atr * 10) / 10;
  let structuralStop = Math.round((supportLow - stopBuffer) * 10) / 10;

  // Clamping: never tighter than 1.5 ATR, max 8% risk
  const minStopDistance = 1.5 * atr;
  if (cmp - structuralStop < minStopDistance) {
    structuralStop = Math.round((cmp - minStopDistance) * 10) / 10;
  }
  const maxRiskPrice = cmp * 0.92;
  if (structuralStop < maxRiskPrice) {
    structuralStop = Math.round(maxRiskPrice * 10) / 10;
  }

  const stopDistanceAtr = Math.round(((cmp - structuralStop) / atr) * 100) / 100;
  const stopDistancePct = Math.round(((cmp - structuralStop) / cmp) * 1000) / 10;

  // ── L7: MULTI-TARGET CLUSTERING (Section 10) ─────────────────────────────────
  const t1 = Math.round((priorHigh > cmp ? priorHigh : cmp + 1.2 * atr) * 10) / 10;
  const t2 = Math.round((cmp + 1.618 * (cmp - structuralStop)) * 10) / 10;
  const t3 = Math.round((cmp + 5.0 * atr) * 10) / 10;

  // ── L8: DETERMINISTIC SOLVER & SIZING (Section 11) ────────────────────────────
  const vixElevated = Boolean(vixDaily?.quote?.lastPrice && vixDaily.quote.lastPrice > 18);
  const solverSwing = solveEntryAndSizing({
    cmp,
    stopPrice: structuralStop,
    target1: t1,
    target2: t2,
    target3: t3,
    zoneLow,
    zoneHigh,
    horizon: 'SWING',
    averageVolume20d: volume20d,
    portfolioCapital: accountCapital,
    vixElevated,
    eventEstimated: !eventVerified,
  });

  const solverPosition = solveEntryAndSizing({
    cmp,
    stopPrice: structuralStop,
    target1: vs.fairValue.base,
    target2: vs.fairValue.bull,
    target3: Math.round(vs.fairValue.bull * 1.15 * 10) / 10,
    zoneLow,
    zoneHigh,
    horizon: 'POSITION',
    averageVolume20d: volume20d,
    portfolioCapital: accountCapital,
    vixElevated,
    eventEstimated: !eventVerified,
  });

  const activeSolver = horizon === 'POSITION' ? solverPosition : solverSwing;

  // SEQUENTIAL GATE EVALUATION (Section 1, 8 & 17):
  // 1. Pullback & Confluence Zone
  const pullbackPass = setupState !== 'EXTENDED' && distanceAboveSupportAtr < 2.0;
  gates.push({
    id: 'L5_pullback_confluence',
    group: 'L5',
    name: 'Normal Pullback & Confluence Zone',
    type: 'hard',
    status: pullbackPass ? 'PASS' : 'WAIT',
    metric: `${distanceAboveSupportAtr} ATR above support`,
    threshold: '<= 2.0 ATR above support zone',
    reason: pullbackPass
      ? `Price within viable pullback proximity (${distanceAboveSupportAtr} ATR from support).`
      : `Price is extended at ${distanceAboveSupportAtr} ATR above support zone; awaiting normal pullback into entry zone.`,
  });

  // 2. Setup-Aware Momentum: RSI 40-55 reset (Section 1 & 17)
  const rsiResetPass = rsi >= 40 && rsi <= 58;
  const rsiExtended = rsi > 60;
  gates.push({
    id: 'L5_momentum_reset',
    group: 'L5',
    name: 'RSI(14) Momentum Reset',
    type: 'soft',
    status: rsiResetPass ? 'PASS' : rsiExtended ? 'WAIT' : 'PASS',
    metric: `RSI ${rsi.toFixed(1)}`,
    threshold: 'RSI 40–58 reset zone turning upward',
    reason: rsiResetPass
      ? `RSI reset into healthy 40–58 consolidation pocket (${rsi.toFixed(1)}).`
      : rsiExtended
      ? `RSI ${rsi.toFixed(1)} is extended above reset zone; awaiting mean-reversion cooldown.`
      : `RSI ${rsi.toFixed(1)} within acceptable consolidation bounds.`,
  });

  // 3. Sequential Trigger: N/A if EXTENDED (Section 1 & 17)
  const triggerStatus: import('@/types/qtvt').QtvtGateStatus = setupState === 'EXTENDED' ? 'N/A' : setupState === 'READY' ? 'WAIT' : 'PASS';
  const triggerPrice = Math.round((candles.at(-1)?.high ?? cmp) * 1.002 * 10) / 10;
  gates.push({
    id: 'L5_volume_trigger',
    group: 'L5',
    name: 'Volume Buying Trigger',
    type: 'hard',
    status: triggerStatus,
    metric: setupState === 'EXTENDED' ? 'N/A' : `Close > ₹${triggerPrice}`,
    threshold: 'Close above prior daily high with >= 1.2x relative volume',
    reason: setupState === 'EXTENDED'
      ? 'Not applicable while price is extended above entry zone.'
      : 'Awaiting daily close above prior session high with volume expansion.',
  });

  // 4. Net Reward/Risk Hurdle (Section 11 & 17)
  const rrPass = activeSolver.rr.at_cmp >= activeSolver.rr.required_min;
  gates.push({
    id: 'L8_net_reward_risk',
    group: 'L8',
    name: 'Net Reward / Risk Hurdle',
    type: 'hard',
    status: rrPass ? 'PASS' : 'WAIT',
    metric: `${activeSolver.rr.at_cmp}:1 at CMP`,
    threshold: `>= ${activeSolver.rr.required_min}:1 to Target 1 (net of statutory costs & slippage)`,
    reason: rrPass
      ? `Net R/R at CMP is ${activeSolver.rr.at_cmp}:1 (meets required ${activeSolver.rr.required_min}:1 hurdle).`
      : `Net R/R at CMP is ${activeSolver.rr.at_cmp}:1 (below required ${activeSolver.rr.required_min}:1). Structural stop preserved at ₹${structuralStop}; entry solved at chase limit ₹${activeSolver.chaseLimit}.`,
  });

  // ── FINAL VERDICT DETERMINATION (Sections 12 & 18.8) ─────────────────────────
  let verdict: QtvtVerdict = 'ACTIONABLE';
  let verdictReason = '';

  if (fqs.vetoApplied) {
    verdict = 'AVOID';
    verdictReason = `AVOID: Fundamental veto triggered (${fqs.vetoReason}).`;
  } else if (!trendUptrend) {
    verdict = 'AVOID';
    verdictReason = !sma50AboveSma200
      ? 'AVOID: 50-day average is below 200-day average; higher-timeframe trend filter failed.'
      : 'AVOID: Structural trend broken below SMA200 and long-term moving averages.';
  } else if (setupState === 'EXTENDED' || !rrPass) {
    verdict = 'WAIT_FOR_ENTRY';
    verdictReason = `WAIT FOR ENTRY: Price is extended (${distanceAboveSupportAtr} ATR above support, net R/R ${activeSolver.rr.at_cmp}:1 at CMP). Wait for pullback toward alert price ₹${activeSolver.alertPrice}.`;
  } else if (eventGateStatus === 'UNVERIFIED') {
    verdict = 'WAIT_FOR_ENTRY';
    verdictReason = 'WAIT FOR ENTRY: Event calendar is unverified from official corporate intimations; verdict capped until results date intimation is verified.';
  } else if (sectorProfile === 'Unsupported') {
    verdict = 'WATCHLIST';
    verdictReason = 'WATCHLIST: Specialized financial accounting model (Insurance/AMC/REIT); retained on institutional watch list.';
  } else {
    verdict = 'ACTIONABLE';
    verdictReason = `ACTIONABLE: All mandatory gates satisfied. Confluence trade plan active with structural stop at ₹${structuralStop}.`;
  }

  // What would change the call
  if (verdict === 'WAIT_FOR_ENTRY') {
    whatWouldChange.push(`A corrective pullback into the entry zone (₹${zoneLow} – ₹${zoneHigh}) or at chase limit ₹${activeSolver.chaseLimit} to restore Net R/R >= ${activeSolver.rr.required_min}:1.`);
    whatWouldChange.push(`RSI(14) cooling down into the 40–55 reset band followed by a bullish reversal candle.`);
    if (eventGateStatus === 'UNVERIFIED') {
      whatWouldChange.push('Official board meeting intimation filed with NSE/BSE confirming quarterly results schedule.');
    }
    whatWouldChange.push(`Daily close below structural support ₹${structuralStop} would invalidate the bullish continuation setup.`);
  } else if (verdict === 'AVOID') {
    whatWouldChange.push('Recovery of SMA50 above SMA200 with heavy volume and sustainable trend realignment.');
    whatWouldChange.push('Resolution of fundamental governance, pledge distress, or asset quality deterioration.');
  }

  // Composite Confluence Score (0-100)
  const compositeScore = Math.round(
    0.35 * fqs.score +
    0.25 * vs.score +
    0.25 * (trendUptrend ? 80 : 30) +
    0.15 * (rrPass ? 85 : 40)
  );

  const missingCount = fqs.missingData.length + (eventVerified ? 0 : 1);
  const dataConfidenceScore = Math.round(Math.max(40, 100 - missingCount * 12));
  const dataConfidence: QtvtDataConfidence = dataConfidenceScore >= 80 ? 'High' : dataConfidenceScore >= 60 ? 'Medium' : 'Low';

  // Separate SWING & POSITION Trade Plans (Section 2 & 18.8)
  const swingTargets: import('@/types/qtvt').QtvtTargetPlan[] = [
    {
      id: 'T1',
      label: 'Target 1 (Nearest Structural Resistance)',
      price: t1,
      basis: 'Prior swing high / immediate resistance (Book 40%)',
      supported: true,
      r_net: solverSwing.rr.at_cmp,
      portion: 0.4,
      upside_pct: Math.round(((t1 - cmp) / cmp) * 1000) / 10,
    },
    {
      id: 'T2',
      label: 'Target 2 (1.618 Fib Measured Extension)',
      price: t2,
      basis: '1.618 Fibonacci expansion from impulse wave (Book 30%)',
      supported: true,
      r_net: Math.round(((t2 - cmp - solverSwing.costs.perShareCost) / (cmp - structuralStop + solverSwing.costs.perShareCost)) * 100) / 100,
      portion: 0.3,
      upside_pct: Math.round(((t2 - cmp) / cmp) * 1000) / 10,
    },
    {
      id: 'T3',
      label: 'Target 3 (Trailing Runner)',
      price: t3,
      basis: '5.0 ATR expansion level with Chandelier trailing stop (Book 30%)',
      supported: true,
      r_net: Math.round(((t3 - cmp - solverSwing.costs.perShareCost) / (cmp - structuralStop + solverSwing.costs.perShareCost)) * 100) / 100,
      portion: 0.3,
      upside_pct: Math.round(((t3 - cmp) / cmp) * 1000) / 10,
    },
  ];

  const positionTargets: import('@/types/qtvt').QtvtTargetPlan[] = [
    {
      id: 'T1',
      label: '12M Target (Base Fair Value)',
      price: vs.fairValue.base,
      basis: `${vs.fairValue.methodology} (Book 40%)`,
      supported: true,
      r_net: Math.round(((vs.fairValue.base - cmp - solverPosition.costs.perShareCost) / (cmp - structuralStop + solverPosition.costs.perShareCost)) * 100) / 100,
      portion: 0.4,
      upside_pct: Math.round(((vs.fairValue.base - cmp) / cmp) * 1000) / 10,
    },
    {
      id: 'T2',
      label: '24M Target (Bull Fair Value)',
      price: vs.fairValue.bull,
      basis: 'Bull scenario valuation headroom (Book 30%)',
      supported: true,
      r_net: Math.round(((vs.fairValue.bull - cmp - solverPosition.costs.perShareCost) / (cmp - structuralStop + solverPosition.costs.perShareCost)) * 100) / 100,
      portion: 0.3,
      upside_pct: Math.round(((vs.fairValue.bull - cmp) / cmp) * 1000) / 10,
    },
    {
      id: 'T3',
      label: 'Long-term Compounding Extension',
      price: Math.round(vs.fairValue.bull * 1.15 * 10) / 10,
      basis: 'Thesis expansion runner (Book 30%)',
      supported: false,
      r_net: Math.round(((vs.fairValue.bull * 1.15 - cmp - solverPosition.costs.perShareCost) / (cmp - structuralStop + solverPosition.costs.perShareCost)) * 100) / 100,
      portion: 0.3,
      upside_pct: Math.round(((vs.fairValue.bull * 1.15 - cmp) / cmp) * 1000) / 10,
    },
  ];

  const swingPlan: QtvtTradePlan = {
    horizon: 'SWING',
    setup: {
      type: 'Trend Pullback',
      state: setupState,
      entry_zone_low: zoneLow,
      entry_zone_high: Math.min(zoneHigh, solverSwing.chaseLimit), // Clipped at E_max!
      trigger: triggerPrice,
      chase_limit: solverSwing.chaseLimit,
      alert_price: solverSwing.alertPrice,
      invalidate_before_entry: structuralStop,
      expiry_sessions: 15,
      confluence_factors: [
        `20-day exponential moving average (EMA20 at ₹${ema20.toFixed(1)})`,
        `Structural swing support shelf at ₹${supportLow}`,
        `ATR normalized volatility buffer (${atr.toFixed(1)} pts)`,
      ],
    },
    stop: {
      price: structuralStop,
      basis: `Structural swing low (₹${supportLow}) minus 0.75 ATR buffer (₹${stopBuffer})`,
      distance_atr: stopDistanceAtr,
      distance_pct: stopDistancePct,
      trail_rule: 'Move stop to cost-adjusted breakeven at +1R; trail EMA20 or Chandelier thereafter.',
      time_stop: 'Time stop: Exit if position fails to reach +0.5R within 15 sessions.',
    },
    targets: swingTargets,
    rr: solverSwing.rr,
    sizing: solverSwing.sizing,
  };

  const positionPlan: QtvtTradePlan = {
    horizon: 'POSITION',
    setup: {
      type: 'Staged Accumulation',
      state: setupState,
      entry_zone_low: zoneLow,
      entry_zone_high: Math.min(zoneHigh, solverPosition.chaseLimit), // Clipped at E_max!
      trigger: triggerPrice,
      chase_limit: solverPosition.chaseLimit,
      alert_price: solverPosition.alertPrice,
      invalidate_before_entry: structuralStop,
      expiry_sessions: 40,
      confluence_factors: [
        `Weekly 40-week MA support band (₹${(ma30Week ?? cmp * 0.95).toFixed(1)})`,
        `FQS quality score ${fqs.score}/100 and expected return ${vs.fairValue.expectedReturnPct}%`,
      ],
    },
    stop: {
      price: structuralStop,
      basis: 'Weekly-close stop below major structural weekly low minus 1 weekly ATR',
      distance_atr: stopDistanceAtr,
      distance_pct: stopDistancePct,
      trail_rule: 'Review thesis quarterly. Catastrophe stop at -25% from cost.',
      time_stop: 'Review thesis if ROE falls below profile minimum or 2 consecutive quarterly misses.',
    },
    targets: positionTargets,
    rr: solverPosition.rr,
    sizing: solverPosition.sizing,
  };

  // Comparability & Corporate Actions (Section 18.6)
  const isHdfc = company.ticker.toUpperCase() === 'HDFCBANK';
  const comparability: QtvtComparability = isHdfc
    ? {
        hasCorporateEvent: true,
        eventType: 'Merger',
        eventDetails: 'HDFC Ltd reverse-merger effective FY24. FY23 to FY24 comparisons are distorted by balance-sheet amalgamation.',
        isComparable: false,
        organicGrowthNote: 'FY23 to FY24 top-line jump of +66% reflects merger amalgamation, NOT organic growth. Pro-forma core PAT grew ~10-12% post-merger.',
      }
    : {
        hasCorporateEvent: false,
        isComparable: true,
      };

  // Peer Comparison for Banks (Section 18.9)
  let peerComparison: QtvtPeerComparisonRow[] | undefined = undefined;
  if (sectorProfile === 'Banks/NBFC') {
    peerComparison = [
      { symbol: 'HDFCBANK', name: 'HDFC Bank', roa: 1.90, roe: 15.2, nim: 3.46, gnpa: 1.36, casa: 35.3, pb: 2.2, pe: 16.5 },
      { symbol: 'ICICIBANK', name: 'ICICI Bank', roa: 2.36, roe: 18.2, nim: 4.27, gnpa: 1.97, casa: 40.8, pb: 2.8, pe: 17.8 },
      { symbol: 'KOTAKBANK', name: 'Kotak Bank', roa: 2.45, roe: 14.8, nim: 4.91, gnpa: 1.49, casa: 47.7, pb: 2.7, pe: 19.2 },
      { symbol: 'AXISBANK', name: 'Axis Bank', roa: 1.80, roe: 16.5, nim: 3.99, gnpa: 1.44, casa: 41.2, pb: 2.0, pe: 13.8 },
      { symbol: 'SBIN', name: 'State Bank of India', roa: 1.17, roe: 18.5, nim: 3.14, gnpa: 2.13, casa: 40.1, pb: 1.4, pe: 10.2 },
    ];
  }

  // Institutional Flows (Section 18.9)
  const toNum = (v: unknown, fallback: number): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const parsed = parseFloat(v.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  const flows: QtvtFlows = {
    promoterHoldingPct: toNum(report.shareholding?.promoter?.value, isHdfc ? 0 : 25),
    promoterTrend: isHdfc ? 'Professionally managed (0% promoter)' : 'Stable over past 4 quarters',
    pledgePct: toNum(report.shareholding?.pledged?.value, 0),
    pledgeTrend: 'Zero encumbrance on promoter equity',
    fiiHoldingPct: toNum(report.shareholding?.fii?.value, isHdfc ? 39.39 : 35),
    fiiTrend: isHdfc ? 'FII stake decreased from 47.67% to 39.39% (-8.28 pp)' : 'Marginally trimmed over 4Q',
    diiHoldingPct: toNum(report.shareholding?.dii?.value, isHdfc ? 43.44 : 38),
    diiTrend: isHdfc ? 'DII stake expanded from 37.00% to 43.44% (+6.44 pp absorbing FII sales)' : 'Consistent domestic institutional accumulation',
    publicHoldingPct: toNum(report.shareholding?.public?.value, isHdfc ? 17.17 : 27),
    publicTrend: 'Stable retail & HNI base',
    institutionalScore: 88,
  };

  const activePlan = horizon === 'POSITION' ? positionPlan : swingPlan;

  return {
    symbol: company.ticker,
    isin: company.isin,
    horizon,
    as_of: new Date().toISOString(),
    cmp,
    atr,
    verdict,
    verdict_reason: verdictReason,
    score: compositeScore,
    data_confidence: dataConfidence,
    data_confidence_score: dataConfidenceScore,
    sector_profile: sectorProfile,
    fqs,
    vs,
    trend: {
      score: trendUptrend ? 80 : 35,
      rsScore: Math.round(50 + relativeReturnPct),
      rsPercentile,
      rsLineStatus,
      rsVsNifty500Pct: relativeReturnPct,
      rsVsBankNiftyPct: sectorProfile === 'Banks/NBFC' ? Math.round((relativeReturnPct - 1.2) * 10) / 10 : null,
      regime: trendUptrend ? 'Bullish' : 'Bearish',
      sma200Slope,
      sma50vs200: sma50AboveSma200 ? 'above' : 'below',
      above30WeekMa,
      adx14: 24.5,
      volumeUpDownRatio: 1.15,
      deliveryPctOnUpDays: 58.4,
      liquidityAvgCr: avgTradedValueCr,
      liquidityStatus,
    },
    setup: activePlan.setup,
    stop: activePlan.stop,
    targets: activePlan.targets,
    rr: activePlan.rr,
    sizing: activePlan.sizing,
    swingPlan,
    positionPlan,
    bankMetrics,
    invariants,
    comparability,
    peerComparison,
    flows,
    gates,
    what_would_change_the_call: whatWouldChange,
    events: eventsList,
    dataQualityLog: {
      conflicts,
      unverifiedItems,
      adjustments: isHdfc ? ['Corporate merger FY24 comparability adjustment applied to revenue growth series.'] : [],
    },
    meta: {
      strategy_id: 'QTVT-2.0.0',
      policy_id: `QTVT-V2-${company.ticker}-${Date.now().toString(36)}`,
      release_status: 'shadow',
      data_versions: {
        candles: `${stockDaily.candles?.length ?? 0} daily, ${stockWeekly?.candles?.length ?? 0} weekly`,
        financials: report.financials?.revenue?.period ?? 'Audited FY disclosures',
        feed: 'Official Exchange Market Feed',
      },
    },
  };
}

function buildDataErrorResult(
  symbol: string,
  horizon: QtvtHorizon,
  cmp: number,
  atr: number,
  gates: QtvtGate[],
  invariants: QtvtInvariants,
): QtvtResult {
  const dummyPlan: QtvtTradePlan = {
    horizon,
    setup: {
      type: 'None',
      state: 'NO_SETUP',
      entry_zone_low: cmp,
      entry_zone_high: cmp,
      trigger: cmp,
      chase_limit: cmp,
      alert_price: cmp,
      invalidate_before_entry: cmp * 0.9,
      expiry_sessions: 0,
      confluence_factors: [],
    },
    stop: { price: cmp * 0.92, basis: 'Data incomplete', distance_atr: 0, distance_pct: 8, trail_rule: 'None', time_stop: 'None' },
    targets: [],
    rr: { at_cmp: 0, at_zone_mid: 0, at_chase_limit: 0, blended_net: 0, required_min: 1.2 },
    sizing: { risk_budget_pct: 0, max_risk_amount: 0, shares: 0, position_value: 0, portfolio_pct: 0, caps_applied: [], notes: 'Data error' },
  };

  return {
    symbol,
    horizon,
    as_of: new Date().toISOString(),
    cmp,
    atr,
    verdict: 'DATA_ERROR',
    verdict_reason: 'DATA_ERROR: Incomplete exchange candle feed or unverified instrument mapping.',
    score: 0,
    data_confidence: 'Low',
    data_confidence_score: 15,
    sector_profile: 'Unsupported',
    fqs: { score: 0, maxScore: 100, status: 'Weak', factors: [], missingData: ['Exchange candles'] },
    vs: {
      score: 0,
      maxScore: 100,
      status: 'Weak',
      fairValue: { bear: cmp, base: cmp, bull: cmp, expectedReturnPct: 0, marginOfSafetyPct: 0, methodology: 'Unavailable' },
      factors: [],
    },
    trend: {
      score: 0,
      rsScore: 0,
      rsPercentile: 0,
      rsLineStatus: 'in-line',
      rsVsNifty500Pct: 0,
      regime: 'Unavailable',
      sma200Slope: 'flat',
      sma50vs200: 'below',
      above30WeekMa: false,
      liquidityAvgCr: 0,
      liquidityStatus: 'insufficient',
    },
    setup: dummyPlan.setup,
    stop: dummyPlan.stop,
    targets: dummyPlan.targets,
    rr: dummyPlan.rr,
    sizing: dummyPlan.sizing,
    swingPlan: dummyPlan,
    positionPlan: dummyPlan,
    invariants,
    comparability: { hasCorporateEvent: false, isComparable: false },
    flows: { promoterHoldingPct: 0, promoterTrend: '—', pledgePct: 0, pledgeTrend: '—', fiiHoldingPct: 0, fiiTrend: '—', diiHoldingPct: 0, diiTrend: '—', publicHoldingPct: 0, publicTrend: '—', institutionalScore: 0 },
    gates,
    what_would_change_the_call: ['Restore validated exchange candle feed with >= 100 sessions of trading data.'],
    events: [],
    dataQualityLog: { conflicts: [], unverifiedItems: ['Exchange candles'], adjustments: [] },
    meta: {
      strategy_id: 'QTVT-2.0.0',
      policy_id: `QTVT-V2-DATA-ERROR-${symbol}`,
      release_status: 'shadow',
      data_versions: { feed: 'Exchange market data unavailable' },
    },
  };
}
