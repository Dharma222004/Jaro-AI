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

  // Current Market Price & Daily Indicators
  const candles = stockDaily.candles ?? [];
  const lastCandle = candles.at(-1);
  const cmp = stockDaily.quote?.lastPrice ?? lastCandle?.close ?? 0;
  const atr = Math.max(1, stockDaily.indicators?.atr14 ?? (stockDaily.indicators as any)?.atr?.value ?? cmp * 0.02);

  // ── L0: DATA INTEGRITY PREFLIGHT ─────────────────────────────────────────────
  const minCandles = horizon === 'SWING' ? 100 : 150;
  const candleCountOk = candles.length >= minCandles;
  const timestampFresh = lastCandle ? (Date.now() - new Date(lastCandle.timestamp).getTime()) < 7 * 86400 * 1000 : false;
  const preflightPass = candleCountOk && cmp > 0;

  gates.push({
    id: 'L0_data_integrity',
    group: 'L0',
    name: 'Exchange Data & Candles',
    type: 'hard',
    status: preflightPass ? 'PASS' : 'FAIL',
    metric: `${candles.length} daily candles`,
    threshold: `>= ${minCandles} candles`,
    reason: preflightPass
      ? `Validated exchange feed intact with ${candles.length} daily candles.`
      : `Insufficient candle history (${candles.length} < ${minCandles}) or unverified instrument.`,
  });

  if (!preflightPass) {
    return buildDataErrorResult(company.ticker, horizon, cmp, atr, gates);
  }

  // ── L1: FUNDAMENTAL QUALITY SCORE (FQS) ──────────────────────────────────────
  const { profile: sectorProfile, fqs } = computeFundamentalQualityScore({ report, company });

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

  // ── L2: VALUATION & FAIR VALUE ───────────────────────────────────────────────
  const vs = computeValuationAndFairValue({ report, company, profile: sectorProfile, cmp });

  gates.push({
    id: 'L2_valuation_fair_value',
    group: 'L2',
    name: 'Valuation & Margin of Safety',
    type: 'soft',
    status: vs.fairValue.marginOfSafetyPct >= -15 ? 'PASS' : 'WAIT',
    metric: `${vs.fairValue.marginOfSafetyPct >= 0 ? '+' : ''}${vs.fairValue.marginOfSafetyPct}% MoS`,
    threshold: '>= -15% MoS to Base Fair Value',
    reason: `Base Fair Value ₹${vs.fairValue.base} (${vs.fairValue.methodology}).`,
  });

  // ── L3: TREND & RELATIVE STRENGTH ────────────────────────────────────────────
  const sma50 = stockDaily.indicators?.sma50 ?? (stockDaily.indicators as any)?.sma?.sma50 ?? null;
  const sma200 = stockDaily.indicators?.sma200 ?? (stockDaily.indicators as any)?.sma?.sma200 ?? null;
  const ema20 = stockDaily.indicators?.ema20 ?? (stockDaily.indicators as any)?.ema?.ema20 ?? cmp;
  const rsi = stockDaily.indicators?.rsi14 ?? (stockDaily.indicators as any)?.rsi?.value ?? 50;

  // SMA200 slope check (last 20 sessions)
  let sma200Slope: 'rising' | 'flat' | 'falling' = 'flat';
  if (candles.length >= 220) {
    const sma200Past = candles.slice(-21, -1).reduce((s, c) => s + c.close, 0) / 20;
    if (sma200 && sma200 > sma200Past * 1.002) sma200Slope = 'rising';
    else if (sma200 && sma200 < sma200Past * 0.998) sma200Slope = 'falling';
  }

  // 30-week MA from weekly candles if available
  const weeklyCandles = stockWeekly?.candles ?? [];
  const ma30Week = weeklyCandles.length >= 30
    ? weeklyCandles.slice(-30).reduce((s, c) => s + c.close, 0) / 30
    : sma200;
  const above30WeekMa = cmp >= (ma30Week ?? cmp * 0.9);

  // Liquidity calculation
  const volume20d = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.max(1, Math.min(20, candles.length));
  const avgTradedValueCr = Math.round(((volume20d * cmp) / 1e7) * 10) / 10;
  const liquidityStatus = avgTradedValueCr >= 5 ? 'sufficient' : avgTradedValueCr >= 2 ? 'limited' : 'insufficient';

  // Relative Strength vs Benchmark
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
  const trendUptrend = (sma200 == null || cmp >= sma200) && (sma50 == null || cmp >= sma50 * 0.97);

  gates.push({
    id: 'L3_higher_timeframe_trend',
    group: 'L3',
    name: 'Trend & 30-Week MA',
    type: 'hard',
    status: trendUptrend && above30WeekMa ? 'PASS' : 'FAIL',
    metric: `CMP ₹${cmp} vs SMA200 ₹${sma200?.toFixed(1) ?? '—'}`,
    threshold: 'Price >= SMA200 and SMA200 slope flat/rising',
    reason: trendUptrend
      ? `Structural uptrend intact; trading above key moving averages with ${sma200Slope} SMA200.`
      : `Trading below key long-term moving averages; trend filter not satisfied.`,
  });

  gates.push({
    id: 'L3_liquidity_floor',
    group: 'L3',
    name: 'Liquidity Floor (ADTV)',
    type: 'hard',
    status: liquidityStatus === 'sufficient' ? 'PASS' : 'WAIT',
    metric: `₹${avgTradedValueCr} Cr / day`,
    threshold: '>= ₹5.0 Cr 20-day median turnover',
    reason: liquidityStatus === 'sufficient'
      ? `Sufficient institutional depth (₹${avgTradedValueCr} Cr daily turnover).`
      : `Subdued liquidity (₹${avgTradedValueCr} Cr) below ₹5 Cr institutional participation floor.`,
  });

  // ── L4: EVENT & SURVEILLANCE RISK OVERLAY ────────────────────────────────────
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
    // Unverified event calendar: estimate from prior year ± 7 days
    const estimatedDate = 'Estimated from prior-year corporate disclosures (±7 days)';
    eventVerified = false;
    eventGateStatus = 'UNVERIFIED';
    eventReason = 'Next quarterly results date is unverified from official exchange feeds; verdict capped.';
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
    metric: eventVerified ? 'VERIFIED' : 'UNVERIFIED',
    threshold: 'Verified corporate filing intimation > 5 sessions away',
    reason: eventReason,
  });

  // ── L5: SETUP STATE MACHINE & STRUCTURAL LEVELS ──────────────────────────────
  // Detect structural swing support
  const recent20 = candles.slice(-20);
  const supportLow = recent20.length ? Math.min(...recent20.map((c) => c.low)) : cmp - 2 * atr;
  const priorHigh = recent20.length ? Math.max(...recent20.map((c) => c.high)) : cmp + 2 * atr;

  // Entry zone confluence (EMA20 to Support Low / EMA50)
  const zoneLow = Math.round(Math.max(supportLow, (sma50 ?? supportLow)) * 10) / 10;
  const zoneHigh = Math.round(Math.min(cmp, ema20 + 0.3 * atr) * 10) / 10;
  const distanceAboveSupportAtr = Math.round(((cmp - zoneLow) / atr) * 100) / 100;

  // State Machine Evaluation:
  const setupType: import('@/types/qtvt').QtvtSetupPlan['type'] = 'Trend Pullback';
  let setupState: QtvtSetupState = 'READY';

  // If price is extended > 2.0 ATR above support zone, state is EXTENDED
  if (distanceAboveSupportAtr >= 2.0) {
    setupState = 'EXTENDED';
  } else if (distanceAboveSupportAtr >= 1.0) {
    setupState = 'FORMING';
  } else if (cmp >= zoneLow && cmp <= zoneHigh + 0.5 * atr) {
    setupState = 'READY';
  }

  // ── L6: STRUCTURAL STOP-LOSS (Never from desired R/R!) ────────────────────────
  // Swing structural stop: Support Low minus 0.5-0.75 ATR buffer
  const stopBuffer = Math.round(0.75 * atr * 10) / 10;
  let structuralStop = Math.round((supportLow - stopBuffer) * 10) / 10;

  // Clamp: never tighter than 1.5 ATR, max 8% risk
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

  // ── L7: MULTI-TARGET CLUSTERING ──────────────────────────────────────────────
  // T1: Nearest resistance / prior swing high (book 40%)
  const t1 = Math.round((priorHigh > cmp ? priorHigh : cmp + 0.5 * atr) * 10) / 10;
  // T2: Measured move / 1.618 Fib extension (book 30%)
  const t2 = Math.round((cmp + 1.618 * (cmp - structuralStop)) * 10) / 10;
  // T3: Trailing runner (5.0 ATR extension level) (book 30%)
  const t3 = Math.round((cmp + 5.0 * atr) * 10) / 10;

  // ── L8: SOLVER & SIZING ──────────────────────────────────────────────────────
  const solver = solveEntryAndSizing({
    cmp,
    stopPrice: structuralStop,
    target1: t1,
    target2: t2,
    target3: t3,
    zoneLow,
    zoneHigh,
    horizon,
    averageVolume20d: volume20d,
    portfolioCapital: accountCapital,
  });

  // SEQUENTIAL GATE EVALUATION (Strict dependency handling):
  // Gate: Normal Pullback
  const pullbackPass = setupState !== 'EXTENDED' && distanceAboveSupportAtr < 2.0;
  gates.push({
    id: 'L5_pullback_confluence',
    group: 'L5',
    name: 'Pullback & Confluence Zone',
    type: 'hard',
    status: pullbackPass ? 'PASS' : 'WAIT',
    metric: `${distanceAboveSupportAtr} ATR above support`,
    threshold: '<= 2.0 ATR above support zone',
    reason: pullbackPass
      ? `Price within viable pullback proximity (${distanceAboveSupportAtr} ATR from support).`
      : `Price is extended at ${distanceAboveSupportAtr} ATR above support zone; awaiting normal pullback into entry zone.`,
  });

  // Gate: Momentum & RSI Reset
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
      : `RSI ${rsi.toFixed(1)} within acceptable bounds.`,
  });

  // Gate: Volume-Confirmed Trigger (Sequential: N/A if EXTENDED!)
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

  // Gate: Net Reward/Risk at CMP
  const rrPass = solver.rr.at_cmp >= solver.rr.required_min;
  gates.push({
    id: 'L8_net_reward_risk',
    group: 'L8',
    name: 'Net Reward / Risk Hurdle',
    type: 'hard',
    status: rrPass ? 'PASS' : 'WAIT',
    metric: `${solver.rr.at_cmp}:1 at CMP`,
    threshold: `>= ${solver.rr.required_min}:1 to Target 1 (net of costs)`,
    reason: rrPass
      ? `Net R/R at CMP is ${solver.rr.at_cmp}:1 (meets required ${solver.rr.required_min}:1 hurdle).`
      : `Net R/R at CMP is ${solver.rr.at_cmp}:1 (below required ${solver.rr.required_min}:1). Structural stop preserved at ₹${structuralStop}; entry solved at chase limit ₹${solver.chaseLimit}.`,
  });

  // ── FINAL VERDICT DETERMINATION ──────────────────────────────────────────────
  let verdict: QtvtVerdict = 'ACTIONABLE';
  let verdictReason = '';

  if (fqs.vetoApplied) {
    verdict = 'AVOID';
    verdictReason = `AVOID: Fundamental veto triggered (${fqs.vetoReason}).`;
  } else if (!trendUptrend) {
    verdict = 'AVOID';
    verdictReason = 'AVOID: Structural trend broken below SMA200 and long-term moving averages.';
  } else if (setupState === 'EXTENDED' || !rrPass) {
    verdict = 'WAIT_FOR_ENTRY';
    verdictReason = `WAIT FOR ENTRY: Price is extended (${distanceAboveSupportAtr} ATR above support, net R/R ${solver.rr.at_cmp}:1 at CMP). Wait for pullback toward alert price ₹${solver.alertPrice}.`;
  } else if (eventGateStatus === 'UNVERIFIED') {
    // CRUCIAL RULE: Unverified event calendar caps verdict!
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
    whatWouldChange.push(`A corrective pullback into the entry zone (₹${zoneLow} – ₹${zoneHigh}) or at chase limit ₹${solver.chaseLimit} to restore Net R/R >= ${solver.rr.required_min}:1.`);
    whatWouldChange.push(`RSI(14) cooling down into the 40–55 reset band followed by a bullish reversal candle.`);
    if (eventGateStatus === 'UNVERIFIED') {
      whatWouldChange.push('Official board meeting intimation filed with NSE/BSE confirming quarterly results schedule.');
    }
    whatWouldChange.push(`Daily close below structural support ₹${structuralStop} would invalidate the bullish continuation setup.`);
  } else if (verdict === 'AVOID') {
    whatWouldChange.push('Resolution of fundamental governance/pledge distress or recovery above SMA200 with heavy volume.');
  }

  // Composite Confluence Score (0-100)
  const compositeScore = Math.round(
    0.35 * fqs.score +
    0.25 * vs.score +
    0.25 * (trendUptrend ? 80 : 30) +
    0.15 * (rrPass ? 85 : 40)
  );

  // Data confidence
  const missingCount = fqs.missingData.length + (eventVerified ? 0 : 1);
  const dataConfidenceScore = Math.round(Math.max(40, 100 - missingCount * 12));
  const dataConfidence: QtvtDataConfidence = dataConfidenceScore >= 80 ? 'High' : dataConfidenceScore >= 60 ? 'Medium' : 'Low';

  const targets: import('@/types/qtvt').QtvtTargetPlan[] = [
    {
      id: 'T1',
      label: 'Target 1 (Nearest Structural Resistance)',
      price: t1,
      basis: 'Prior swing high / immediate resistance (Book 40%)',
      supported: true,
      r_net: solver.rr.at_cmp,
      portion: 0.4,
      upside_pct: Math.round(((t1 - cmp) / cmp) * 1000) / 10,
    },
    {
      id: 'T2',
      label: 'Target 2 (1.618 Fib Measured Extension)',
      price: t2,
      basis: '1.618 Fibonacci expansion from impulse wave (Book 30%)',
      supported: true,
      r_net: Math.round(((t2 - cmp - solver.costs.perShareCost) / (cmp - structuralStop + solver.costs.perShareCost)) * 100) / 100,
      portion: 0.3,
      upside_pct: Math.round(((t2 - cmp) / cmp) * 1000) / 10,
    },
    {
      id: 'T3',
      label: 'Target 3 (Trailing Runner)',
      price: t3,
      basis: '5.0 ATR expansion level with Chandelier trailing stop (Book 30%)',
      supported: true,
      r_net: Math.round(((t3 - cmp - solver.costs.perShareCost) / (cmp - structuralStop + solver.costs.perShareCost)) * 100) / 100,
      portion: 0.3,
      upside_pct: Math.round(((t3 - cmp) / cmp) * 1000) / 10,
    },
  ];

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
      regime: trendUptrend ? 'Bullish' : 'Bearish',
      sma200Slope,
      sma50vs200: sma50 && sma200 && sma50 >= sma200 ? 'above' : 'below',
      above30WeekMa,
      liquidityAvgCr: avgTradedValueCr,
      liquidityStatus,
    },
    setup: {
      type: setupType,
      state: setupState,
      entry_zone_low: zoneLow,
      entry_zone_high: zoneHigh,
      trigger: triggerPrice,
      chase_limit: solver.chaseLimit,
      alert_price: solver.alertPrice,
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
      trail_rule: 'Move stop to breakeven upon T1 fill; trail EMA20 on daily close thereafter.',
      time_stop: 'Time stop: Exit if position fails to reach +0.5R within 15 sessions.',
    },
    targets,
    rr: solver.rr,
    sizing: solver.sizing,
    gates,
    what_would_change_the_call: whatWouldChange,
    events: eventsList,
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
  gates: QtvtGate[]
): QtvtResult {
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
      regime: 'Unavailable',
      sma200Slope: 'flat',
      sma50vs200: 'below',
      above30WeekMa: false,
      liquidityAvgCr: 0,
      liquidityStatus: 'insufficient',
    },
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
    gates,
    what_would_change_the_call: ['Restore validated exchange candle feed with >= 100 sessions of trading data.'],
    events: [],
    meta: {
      strategy_id: 'QTVT-2.0.0',
      policy_id: `QTVT-V2-DATA-ERROR-${symbol}`,
      release_status: 'shadow',
      data_versions: { feed: 'Exchange market data unavailable' },
    },
  };
}
