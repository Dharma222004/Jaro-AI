import type { CompanyIdentity } from '@/types/company';
import type {
  EntryScenario,
  InvestmentDecisionResult,
  InvestorPositionInput,
  PositionSizingResult,
  StopLossPlan,
  TargetScenario,
  Week52Analysis,
} from '@/types/decision';
import type { ResearchReport, ResearchSourceMeta } from '@/types/research';
import type { TechnicalAnalysisResult } from '@/types/technical';
import { extractInvestorPosition } from './investor-input';
import { scoreFundamentals, scoreRisk, scoreTechnicals, scoreValuation } from './scoring';
import { getCompliancePolicy } from '@/lib/compliance/policy';
import type { StrategyEvaluation, SystematicStrategyResult } from '@/types/strategy';
import { POSITION_SIZING_POLICY } from '@/lib/strategy/config';

export function buildInvestmentDecision(params: {
  query: string;
  company: CompanyIdentity;
  report: ResearchReport;
  primary: TechnicalAnalysisResult;
  confirmation?: TechnicalAnalysisResult;
  daily: TechnicalAnalysisResult;
  sources: ResearchSourceMeta[];
  previousPosition?: InvestorPositionInput;
  systematic?: SystematicStrategyResult;
  qtvt?: import('@/types/qtvt').QtvtResult;
}): InvestmentDecisionResult {
  const generatedAt = new Date().toISOString();
  const compliance = getCompliancePolicy();
  const extracted = extractInvestorPosition(params.query);
  const positionInput = mergePosition(params.previousPosition, extracted);
  const currentPrice = params.primary.quote?.lastPrice ?? params.primary.candles.at(-1)?.close;
  if (!currentPrice) throw new Error('A validated current or latest-available price is required for decision analysis.');

  const fundamentalScore = scoreFundamentals(params.report);
  const valuationScore = scoreValuation(params.report);
  const technicalScore = scoreTechnicals(params.primary, params.confirmation);
  const riskScore = scoreRisk(params.report, params.primary);
  const week52 = calculateWeek52(params.daily, currentPrice);

  const qtvtEntriesList: EntryScenario[] = params.qtvt ? [
    {
      type: params.qtvt.setup.type === 'Base Breakout' ? 'breakout' : 'pullback',
      status: params.qtvt.verdict === 'ACTIONABLE' ? 'actionable-if-confirmed' : params.qtvt.verdict === 'WAIT_FOR_ENTRY' ? 'developing' : 'not-active',
      rangeLow: params.qtvt.setup.entry_zone_low,
      rangeHigh: params.qtvt.setup.entry_zone_high,
      technicalJustification: [
        `QTVT Confluence zone: ${fmtPrice(params.qtvt.setup.entry_zone_low)}–${fmtPrice(params.qtvt.setup.entry_zone_high)}.`,
        `Trigger: Daily close above ${fmtPrice(params.qtvt.setup.trigger)} with volume expansion.`,
        `Chase limit E_max: ${fmtPrice(params.qtvt.setup.chase_limit)} (Hurdle >= ${params.qtvt.rr.required_min}:1).`,
        `Confluence across ${params.qtvt.setup.confluence_factors.join('; ')}.`,
      ],
      fundamentalJustification: [
        `Fundamental Quality Score (FQS): ${params.qtvt.fqs.score}/100 (${params.qtvt.fqs.status}).`,
        `Valuation Score: ${params.qtvt.vs.score}/100 (Margin of safety: ${params.qtvt.vs.fairValue.marginOfSafetyPct}%).`,
      ],
      requiredConfirmation: [
        `Price re-entry into zone ${fmtPrice(params.qtvt.setup.entry_zone_low)}–${fmtPrice(params.qtvt.setup.entry_zone_high)}.`,
        `Bullish trigger candle closing above ${fmtPrice(params.qtvt.setup.trigger)}.`,
      ],
      invalidation: `Close below structural stop ${fmtPrice(params.qtvt.stop.price)} or FQS veto.`,
      riskLevel: params.qtvt.stop.distance_pct > 6 ? 'high' : 'moderate',
    },
  ] : [];

  const entries = params.qtvt
    ? qtvtEntriesList
    : params.systematic
    ? systematicEntries(params.systematic)
    : calculateEntries(params.report, params.primary, params.confirmation, currentPrice);

  const systematicPreferred = params.systematic?.selected ? systematicEntry(params.systematic.selected) : null;
  const preferredEntry = params.qtvt
    ? qtvtEntriesList[0]
    : systematicPreferred ?? selectPreferredEntry(entries, currentPrice, positionInput.purchasePrice, params.primary.trend === 'bullish' && params.confirmation?.trend === 'bullish');

  const entryPrice = positionInput.purchasePrice
    ?? (params.qtvt ? params.qtvt.setup.trigger : params.systematic?.selected?.entry?.triggerPrice)
    ?? (preferredEntry ? midpoint(preferredEntry.rangeLow, preferredEntry.rangeHigh) : currentPrice);

  const hasValidatedEntry = positionInput.purchasePrice != null || preferredEntry != null;

  const stopLoss: StopLossPlan | null = params.qtvt
    ? {
        price: params.qtvt.stop.price,
        approach: `JARO Method v2 QTVT structural stop (${params.qtvt.stop.basis})`,
        justification: [
          `Structural stop set at ${fmtPrice(params.qtvt.stop.price)} based on ${params.qtvt.stop.basis}.`,
          `Distance: ${params.qtvt.stop.distance_atr} ATR (${params.qtvt.stop.distance_pct}% from entry/CMP).`,
          `Trailing rule: ${params.qtvt.stop.trail_rule}.`,
          `Time stop: ${params.qtvt.stop.time_stop}.`,
        ],
        riskPerShare: Math.abs(entryPrice - params.qtvt.stop.price),
        downsidePct: params.qtvt.stop.distance_pct,
        earlyExitConditions: [
          'Daily close below structural support invalidates setup structure immediately.',
          'Auditor qualification, pledge increase above 25%, or fundamental veto.',
          params.qtvt.stop.trail_rule,
        ],
        gapRiskNote: `Structural stop with ${params.qtvt.stop.distance_atr} ATR buffer to absorb opening noise and pre-market gaps.`,
      }
    : params.systematic?.selected?.stop
    ? systematicStop(params.systematic.selected)
    : hasValidatedEntry ? calculateStopLoss(params.primary, params.confirmation, entryPrice, positionInput.horizon ?? 'positional') : null;

  const targets: TargetScenario[] = params.qtvt
    ? params.qtvt.targets.map((target, index) => ({
        label: (target.id === 'T1' ? 'Target 1' : target.id === 'T2' ? 'Target 2' : 'Target 3') as 'Target 1' | 'Target 2' | 'Target 3',
        scenario: (index === 0 ? 'base' : index === 1 ? 'bullish' : 'extended-bullish') as 'base' | 'bullish' | 'extended-bullish',
        price: target.price,
        upsidePct: target.upside_pct,
        riskReward: target.r_net,
        timeframe: params.qtvt!.horizon === 'POSITION' ? '1w' : '1d',
        confidence: (target.supported ? (index === 0 ? 'High confluence' : 'Moderate confluence') : 'Low confluence') as 'High confluence' | 'Moderate confluence' | 'Low confluence',
        justification: `${target.basis} (Book ${Math.round(target.portion * 100)}%). Net R/R ${target.r_net}:1 after statutory costs & slippage.`,
        conditions: [
          `Scale out ${Math.round(target.portion * 100)}% of position at ${fmtPrice(target.price)}.`,
          index === 0 ? 'Move stop to breakeven after Target 1 fill.' : 'Trail remaining position with EMA20 / Chandelier exit.',
        ],
      }))
    : params.systematic?.selected
    ? systematicTargets(params.systematic.selected)
    : hasValidatedEntry && stopLoss ? calculateTargets(params.primary, params.confirmation, week52, entryPrice, stopLoss) : [];

  const classification = classifyDecision({
    ownsStock: positionInput.ownsStock,
    hasPositionDetails: positionInput.purchasePrice != null && positionInput.horizon != null,
    fundamental: fundamentalScore.score,
    valuation: valuationScore.score,
    technical: technicalScore.score,
    risk: riskScore.score,
    trend: params.primary.trend,
    confirmationTrend: params.confirmation?.trend,
    target2RiskReward: targets[1]?.riskReward ?? null,
    target1RiskReward: targets[0]?.riskReward ?? null,
    currentPrice,
    stop: stopLoss?.price ?? null,
    week52,
    systematicEligible: params.systematic?.selected?.eligible ?? false,
    systematicStatus: params.systematic?.selected?.status,
    systematicReleaseStatus: params.systematic?.selected?.releaseStatus,
  });

  if (params.qtvt && !positionInput.ownsStock) {
    if (params.qtvt.verdict === 'ACTIONABLE') {
      classification.code = 'BUY_SETUP';
      classification.label = 'BUY SETUP — All QTVT Confluence Gates Passed';
    } else if (params.qtvt.verdict === 'WAIT_FOR_ENTRY') {
      classification.code = 'WAIT';
      classification.label = `WAIT FOR ENTRY — ${params.qtvt.verdict_reason}`;
    } else if (params.qtvt.verdict === 'AVOID') {
      classification.code = 'WAIT';
      classification.label = `AVOID — ${params.qtvt.verdict_reason}`;
    } else if (params.qtvt.verdict === 'WATCHLIST') {
      classification.code = 'WAIT';
      classification.label = `WATCHLIST — ${params.qtvt.verdict_reason}`;
    } else if (params.qtvt.verdict === 'DATA_ERROR') {
      classification.code = 'GENERAL_ASSESSMENT';
      classification.label = 'DATA ERROR — Exchange feed incomplete';
    }
  }

  const positionSizing: PositionSizingResult | undefined = params.qtvt
    ? {
        policyVersion: `${params.qtvt.meta.strategy_id}-${params.qtvt.meta.policy_id}`,
        capital: positionInput.availableCapital ?? 10_00_000,
        riskPct: params.qtvt.sizing.risk_budget_pct,
        riskAmount: params.qtvt.sizing.max_risk_amount,
        riskPerShare: Math.abs(currentPrice - params.qtvt.stop.price),
        quantity: params.qtvt.sizing.shares,
        capitalRequired: params.qtvt.sizing.position_value,
        estimatedExecutionCosts: params.qtvt.sizing.shares * 1.5,
        estimatedMaximumPlannedLoss: params.qtvt.sizing.max_risk_amount,
        blocked: params.qtvt.verdict === 'AVOID' || params.qtvt.verdict === 'DATA_ERROR',
        blockedReasons: params.qtvt.verdict === 'AVOID' ? [params.qtvt.verdict_reason] : [],
        constraints: [
          `Single-stock cap: max ${params.qtvt.horizon === 'SWING' ? '10%' : '7%'} of account.`,
          `Liquidity cap: max 2% of 20-day median traded volume.`,
          ...params.qtvt.sizing.caps_applied,
        ],
        note: `Deterministic risk-budgeted sizing for ${params.qtvt.horizon} profile. Suggested: ${params.qtvt.sizing.shares} shares (₹${params.qtvt.sizing.position_value.toLocaleString('en-IN')}).`,
      }
    : calculatePositionSizing(
        positionInput,
        entryPrice,
        stopLoss,
        params.systematic?.selected?.costs?.estimatedPerShareCost ?? 0,
        params.systematic?.selected?.stockStrength.averageTradedValueCr ?? null,
        params.primary.instrument.lot_size ?? 1,
      );
  const positives = unique([
    ...params.report.strengths.slice(0, 5),
    ...params.primary.bullishFindings.slice(0, 3),
  ]);
  const risks = unique([
    ...params.report.risks.slice(0, 6).map((risk) => `${risk.risk ?? risk.category}: ${risk.description}`),
    ...params.primary.bearishFindings.slice(0, 3),
  ]);
  const catalysts = unique([...(params.report.growthDrivers ?? []), ...(params.report.futureCatalysts ?? [])]).slice(0, 6);
  const invalidations = unique([
    ...(stopLoss?.earlyExitConditions ?? []),
    'A material deterioration in revenue, profitability, balance-sheet quality or governance versus the latest reported period.',
    ...params.report.risks.filter((risk) => risk.severity === 'high').slice(0, 3).map((risk) => `Escalation of ${risk.risk ?? risk.category}.`),
  ]);

  return {
    company: params.company,
    classification: classification.code,
    classificationLabel: classification.label,
    complianceLabel: compliance.disclosure,
    horizon: positionInput.horizon ?? inferHorizon(params.query),
    currentPrice: roundPrice(currentPrice, params.primary),
    marketTimestamp: params.primary.quote?.timestamp ?? params.primary.lastCandleAt ?? params.primary.retrievedAt,
    marketDataStatus: params.primary.dataStatus,
    financialPeriod: params.report.financials.revenue.period ?? null,
    fundamentalScore,
    valuationScore,
    technicalScore,
    riskScore,
    week52,
    entries,
    preferredEntry,
    targets,
    stopLoss,
    positionSizing,
    scenarios: [
      {
        name: 'Bullish',
        evidence: positives.slice(0, 4),
        outcome: targets[2] ? `An extended move toward ${fmtPrice(targets[2].price)} becomes plausible only if resistance breaks with volume and fundamentals remain intact.` : 'No extended target could be supported from the available structure.',
        invalidation: stopLoss ? `A sustained move below ${fmtPrice(stopLoss.price)} weakens this scenario.` : undefined,
      },
      {
        name: 'Base',
        evidence: [`Primary trend: ${params.primary.trend}`, `Fundamental score: ${fundamentalScore.score ?? 'N/A'} (${fundamentalScore.coveragePct}% coverage)`, `Valuation score: ${valuationScore.score ?? 'N/A'}`],
        outcome: targets[0] ? `Price consolidates between support and the first resistance/target zone near ${fmtPrice(targets[0].price)}.` : 'Range-bound consolidation remains plausible.',
      },
      {
        name: 'Bearish',
        evidence: risks.slice(0, 4),
        outcome: stopLoss ? `A confirmed breakdown below ${fmtPrice(stopLoss.price)} shifts focus to capital preservation and thesis reassessment.` : 'Fundamental or technical deterioration would require reassessment.',
      },
    ],
    investmentThesis: { positives, risks, catalysts, invalidationConditions: invalidations },
    exitStrategy: buildExitStrategy(targets, stopLoss, params.report),
    positionInput,
    technical: { primary: trimTechnical(params.primary), confirmation: params.confirmation ? trimTechnical(params.confirmation) : undefined },
    sources: params.sources,
    generatedAt,
    limitations: buildLimitations(params.report, fundamentalScore.coveragePct, valuationScore.coveragePct, positionInput),
    systematic: params.systematic,
    qtvt: params.qtvt,
  };
}

function calculateWeek52(technical: TechnicalAnalysisResult, current: number): Week52Analysis {
  const lastTime = new Date(technical.candles.at(-1)?.timestamp ?? technical.retrievedAt).getTime();
  const cutoff = lastTime - 365 * 24 * 60 * 60 * 1000;
  const window = technical.candles.filter((candle) => new Date(candle.timestamp).getTime() >= cutoff);
  if (!window.length) throw new Error('Insufficient daily candles for rolling 52-week analysis.');
  const highCandle = window.reduce((best, candle) => candle.high > best.high ? candle : best);
  const lowCandle = window.reduce((best, candle) => candle.low < best.low ? candle : best);
  const distanceFromHighPct = ((highCandle.high - current) / highCandle.high) * 100;
  const distanceFromLowPct = ((current - lowCandle.low) / lowCandle.low) * 100;
  const position = distanceFromHighPct <= 5 ? 'near-high' : distanceFromLowPct <= 10 ? 'near-low' : 'middle-range';
  const interpretation = position === 'near-low'
    ? 'Price is near its rolling 52-week low. This is not automatically undervaluation; financial trends and thesis risks must distinguish temporary price weakness from business deterioration.'
    : position === 'near-high'
      ? 'Price is near its rolling 52-week high. Momentum may be constructive, but breakout confirmation and valuation discipline remain important.'
      : 'Price is between its rolling 52-week extremes; support, resistance and fundamental value matter more than range position alone.';
  return {
    high: roundPrice(highCandle.high, technical), low: roundPrice(lowCandle.low, technical), current: roundPrice(current, technical),
    highTimestamp: highCandle.timestamp, lowTimestamp: lowCandle.timestamp,
    distanceFromHighPct: roundPct(distanceFromHighPct), distanceFromLowPct: roundPct(distanceFromLowPct),
    declineFromHighPct: roundPct(-distanceFromHighPct), recoveryFromLowPct: roundPct(distanceFromLowPct),
    position, interpretation,
  };
}

function calculateEntries(report: ResearchReport, primary: TechnicalAnalysisResult, confirmation: TechnicalAnalysisResult | undefined, current: number): EntryScenario[] {
  const i = primary.indicators;
  const atr = i.atr14;
  if (atr == null || atr <= 0) return [];
  const tick = tickSize(primary);
  const supports = [i.support, i.ema20, i.ema50, confirmation?.indicators.support]
    .filter((value): value is number => value != null && value > 0 && value <= current)
    .sort((a, b) => b - a);
  const pullbackAnchor = supports[0] ?? Math.min(current, i.ema20 ?? current);
  const resistance = i.resistance ?? Math.max(...primary.candles.slice(-40).map((candle) => candle.high));
  const reversalAnchor = [i.swingLow, i.support, confirmation?.indicators.support]
    .filter((value): value is number => value != null && value > 0 && value <= current)
    .sort((a, b) => b - a)[0] ?? pullbackAnchor;
  const fundamentalsOkay = (scoreFundamentals(report).score ?? 0) >= 55;
  const pullbackActionable = primary.trend === 'bullish'
    && confirmation?.trend !== 'bearish'
    && fundamentalsOkay
    && supports.length > 0;
  return [
    {
      type: 'pullback', status: pullbackActionable ? 'actionable-if-confirmed' : 'developing',
      rangeLow: roundToTick(Math.max(tick, pullbackAnchor - atr * 0.25), tick),
      rangeHigh: roundToTick(pullbackAnchor + atr * 0.15, tick),
      technicalJustification: [`Range is centred on the nearest confluence of support/EMA levels (${fmtPrice(pullbackAnchor)}), with width derived from ATR(14) ${fmtPrice(atr)}.`, `Primary trend is ${primary.trend}; higher-timeframe trend is ${confirmation?.trend ?? 'unavailable'}.`],
      fundamentalJustification: fundamentalsOkay ? ['Available fundamentals meet the minimum research-quality threshold; inspect factor coverage before relying on the score.'] : ['Fundamental evidence is mixed or incomplete, so technical support alone is insufficient.'],
      requiredConfirmation: ['Bullish rejection or a close back above the support zone.', 'No new material negative filing or thesis-breaking development.', 'Momentum stabilisation rather than RSI alone.'],
      invalidation: `A decisive close below ${fmtPrice(reversalAnchor)} with expanding volume invalidates the pullback setup.`,
      riskLevel: primary.indicators.atrPct != null && primary.indicators.atrPct > 4 ? 'high' : 'moderate',
    },
    {
      type: 'breakout', status: current > resistance && (i.relativeVolume ?? 0) >= 1.5 ? 'actionable-if-confirmed' : 'not-active',
      rangeLow: roundToTick(resistance + atr * 0.1, tick),
      rangeHigh: roundToTick(resistance + atr * 0.5, tick),
      technicalJustification: [`Entry starts above observed resistance ${fmtPrice(resistance)} and uses ATR—not a fixed percentage—for the confirmation band.`, `Current relative volume is ${fmt(i.relativeVolume)}x.`],
      fundamentalJustification: fundamentalsOkay ? ['Breakout consideration is conditional on the fundamental thesis remaining intact.'] : ['Weak/incomplete fundamentals reduce the quality of a technical breakout.'],
      requiredConfirmation: ['A candle close above resistance.', 'Relative volume preferably above 1.5x the 20-period average.', 'No immediate failure back into the prior range.'],
      invalidation: `A close back below ${fmtPrice(resistance)} after breakout indicates failure.`,
      riskLevel: 'high',
    },
    {
      type: 'reversal', status: (i.rsi14 ?? 50) < 40 || primary.trend === 'bearish' ? 'developing' : 'not-active',
      rangeLow: roundToTick(Math.max(tick, reversalAnchor - atr * 0.2), tick),
      rangeHigh: roundToTick(reversalAnchor + atr * 0.25, tick),
      technicalJustification: [`Potential reversal zone is anchored to the latest swing/support area ${fmtPrice(reversalAnchor)}.`, `RSI(14) ${fmt(i.rsi14)} and MACD histogram ${fmt(i.macdHistogram)} require price confirmation.`],
      fundamentalJustification: fundamentalsOkay ? ['A reversal setup is more credible when business quality has not deteriorated.'] : ['Do not treat a falling price as value while fundamental evidence is weak or deteriorating.'],
      requiredConfirmation: ['Higher low or bullish reversal candle.', 'MACD/RSI improvement and volume confirmation.', 'Evidence that the decline is not caused by thesis deterioration.'],
      invalidation: `A new closing low below ${fmtPrice(reversalAnchor - atr * 0.5)} invalidates the reversal structure.`,
      riskLevel: 'high',
    },
  ];
}

function selectPreferredEntry(entries: EntryScenario[], current: number, override?: number, allowDevelopingPullback = false): EntryScenario | null {
  if (override) return entries.find((entry) => entry.status === 'actionable-if-confirmed') ?? null;
  return entries.find((entry) => entry.status === 'actionable-if-confirmed' && current >= entry.rangeLow * 0.97 && current <= entry.rangeHigh * 1.03)
    ?? entries.find((entry) => entry.status === 'actionable-if-confirmed')
    ?? (allowDevelopingPullback ? entries.find((entry) => entry.type === 'pullback' && entry.status === 'developing') : null)
    ?? null;
}

function calculateStopLoss(primary: TechnicalAnalysisResult, confirmation: TechnicalAnalysisResult | undefined, entry: number, horizon: string): StopLossPlan | null {
  const selected = horizon === 'long-term' && confirmation ? confirmation : primary;
  const i = selected.indicators;
  const atr = i.atr14;
  if (atr == null) return null;
  const structural = [i.support, i.swingLow].filter((value): value is number => value != null && value < entry).sort((a, b) => b - a)[0];
  const buffer = horizon === 'intraday' ? atr * 0.35 : horizon === 'swing' ? atr * 0.5 : horizon === 'long-term' ? atr * 0.75 : atr * 0.6;
  const raw = structural != null ? structural - buffer : entry - atr * 1.5;
  const price = roundToTick(Math.min(raw, entry - atr * 0.5), tickSize(primary));
  const riskPerShare = entry - price;
  if (riskPerShare <= 0) return null;
  return {
    price,
    approach: `${horizon} structural invalidation with ATR volatility buffer`,
    justification: [`Observed support/swing reference: ${structural == null ? 'unavailable; ATR fallback used' : fmtPrice(structural)}.`, `ATR buffer: ${fmtPrice(buffer)} using ${selected.timeframe} candles.`],
    riskPerShare: roundPrice(riskPerShare, primary), downsidePct: roundPct(riskPerShare / entry * 100),
    earlyExitConditions: ['Confirmed breakdown below support with expanding volume.', 'Material earnings, governance or balance-sheet deterioration.', 'The original catalyst fails or management guidance materially weakens.'],
    gapRiskNote: 'A stop level cannot prevent overnight or event-driven gap losses; execution may occur below the stated level.',
  };
}

function calculateTargets(primary: TechnicalAnalysisResult, confirmation: TechnicalAnalysisResult | undefined, week52: Week52Analysis, entry: number, stop: StopLossPlan | null): TargetScenario[] {
  const atr = primary.indicators.atr14;
  if (atr == null || atr <= 0 || !stop) return [];
  const support = primary.indicators.support ?? entry - atr;
  const resistance = primary.indicators.resistance ?? entry + atr * 1.5;
  const weeklyResistance = confirmation?.indicators.resistance;
  const measuredMove = Math.max(resistance - support, atr * 2);
  const prices = [
    Math.max(resistance, entry + atr * 1.25),
    Math.max(week52.high, weeklyResistance ?? 0, entry + atr * 2.5),
  ];
  const hasExtendedEvidence = primary.trend === 'bullish'
    && confirmation?.trend === 'bullish'
    && (primary.indicators.adx14 ?? 0) >= 20
    && ((primary.indicators.relativeVolume ?? 0) >= 1 || primary.signals.some((signal) => signal.name.includes('breakout') && signal.confirmation === 'confirmed'));
  if (hasExtendedEvidence) prices.push(Math.max(entry + measuredMove * 1.618, week52.high + atr * 1.5));
  const roundedPrices = [...new Set(prices.map((price) => roundToTick(price, tickSize(primary))))]
    .filter((price) => price > entry);
  const labels: TargetScenario['label'][] = ['Target 1', 'Target 2', 'Target 3'];
  const scenarios: TargetScenario['scenario'][] = ['base', 'bullish', 'extended-bullish'];
  return roundedPrices.map((price, index) => {
    const reward = price - entry;
    const riskReward = stop && stop.riskPerShare > 0 ? reward / stop.riskPerShare : null;
    return {
      label: labels[index], scenario: scenarios[index], price,
      upsidePct: roundPct(reward / entry * 100), riskReward: riskReward == null ? null : Math.round(riskReward * 100) / 100,
      timeframe: index === 0 ? primary.timeframe : confirmation?.timeframe ?? primary.timeframe,
      confidence: index === 0 ? 'High confluence' : index === 1 ? 'Moderate confluence' : 'Low confluence',
      justification: index === 0 ? `Nearest observed resistance / ATR objective around ${fmtPrice(resistance)}.` : index === 1 ? 'Rolling 52-week high, higher-timeframe resistance and ATR projection.' : 'Extended measured-move scenario using the observed support-to-resistance range and a 1.618 extension.',
      conditions: index === 0 ? ['Support remains intact.', 'Momentum does not materially deteriorate.'] : index === 1 ? ['Target 1 is cleared and holds as support.', 'Higher-timeframe trend remains constructive.'] : ['Sustained volume-supported breakout.', 'Fundamental thesis and market conditions remain favourable.'],
    };
  });
}

function classifyDecision(input: { ownsStock: boolean; hasPositionDetails: boolean; fundamental: number | null; valuation: number | null; technical: number | null; risk: number | null; trend: string; confirmationTrend?: string; target1RiskReward: number | null; target2RiskReward: number | null; currentPrice: number; stop: number | null; week52: Week52Analysis; systematicEligible: boolean; systematicStatus?: string; systematicReleaseStatus?: string }) {
  const f = input.fundamental ?? 0; const v = input.valuation ?? 0; const t = input.technical ?? 0; const r = input.risk ?? 0;
  if (input.ownsStock && !input.hasPositionDetails) return { code: 'GENERAL_ASSESSMENT' as const, label: 'Position details needed for a HOLD / REDUCE / EXIT classification' };
  if (input.ownsStock) {
    if ((f < 35 && input.trend === 'bearish') || (input.stop != null && input.currentPrice < input.stop)) return { code: 'EXIT_REVIEW' as const, label: 'EXIT REVIEW — thesis or structural risk requires reassessment' };
    if ((input.trend === 'bearish' && input.confirmationTrend === 'bearish') || (v < 25 && input.week52.position === 'near-high')) return { code: 'REDUCE_REVIEW' as const, label: 'REDUCE REVIEW — consider exposure and profit-protection rules' };
    if (f >= 50 && input.confirmationTrend !== 'bearish') return { code: 'HOLD_THESIS' as const, label: 'HOLD THESIS — monitor stated invalidation conditions' };
    return { code: 'GENERAL_ASSESSMENT' as const, label: 'GENERAL HOLDING ASSESSMENT — evidence is mixed' };
  }
  if (input.systematicEligible && f >= 40 && v >= 20 && t >= 50 && r >= 35 && (input.target1RiskReward ?? 0) >= 1.2) return { code: 'BUY_SETUP' as const, label: 'BUY SETUP — all mandatory systematic gates passed' };
  if (input.systematicStatus === 'ENTRY_AVAILABLE' && input.systematicReleaseStatus !== 'validated') return { code: 'WAIT' as const, label: `WAIT — ${input.systematicReleaseStatus ?? 'research'} strategy is not publicly released` };
  return { code: 'WAIT' as const, label: `WAIT — ${input.systematicStatus ? input.systematicStatus.toLowerCase().replaceAll('_', ' ') : 'price, valuation, risk/reward or confirmation is not yet favourable'}` };
}

function systematicEntries(result: SystematicStrategyResult): EntryScenario[] {
  return result.strategies.flatMap((strategy) => {
    const entry = systematicEntry(strategy);
    return entry ? [entry] : [];
  });
}

function systematicEntry(strategy: StrategyEvaluation): EntryScenario | null {
  if (!strategy.entry) return null;
  const status: EntryScenario['status'] = strategy.status === 'ENTRY_AVAILABLE' ? 'actionable-if-confirmed'
    : ['WAIT_FOR_CONFIRMATION', 'WAIT_FOR_PULLBACK', 'BREAKOUT_NOT_CONFIRMED'].includes(strategy.status) ? 'developing' : 'not-active';
  return {
    type: strategy.strategyId === 'breakout_retest' ? 'breakout' : 'pullback',
    status,
    rangeLow: strategy.entry.zoneLow,
    rangeHigh: strategy.entry.zoneHigh,
    technicalJustification: [`${strategy.entry.zoneLabel}: ${fmtPrice(strategy.entry.zoneLow)}–${fmtPrice(strategy.entry.zoneHigh)}.`, strategy.entry.triggerCondition, ...strategy.marketRegime.reasoning.slice(0, 1), ...strategy.stockStrength.reasoning.slice(0, 1)],
    fundamentalJustification: strategy.riskFilters,
    requiredConfirmation: strategy.setupConditions,
    invalidation: strategy.invalidationConditions.join(' '),
    riskLevel: strategy.stockStrength.atrPct != null && strategy.stockStrength.atrPct > 4 ? 'high' : strategy.status === 'ENTRY_AVAILABLE' ? 'moderate' : 'high',
  };
}

function systematicStop(strategy: StrategyEvaluation): StopLossPlan | null {
  if (!strategy.stop) return null;
  return {
    price: strategy.stop.price,
    approach: `${strategy.strategyName} ${strategy.strategyVersion} structure-plus-volatility invalidation`,
    justification: [strategy.stop.reason, `Structural reference ${fmtPrice(strategy.stop.structuralReference)}; ATR buffer ${fmtPrice(strategy.stop.atrBuffer)}.`],
    riskPerShare: strategy.stop.riskPerShare,
    downsidePct: strategy.stop.downsidePct,
    earlyExitConditions: strategy.invalidationConditions,
    gapRiskNote: strategy.stop.gapRisk,
  };
}

function systematicTargets(strategy: StrategyEvaluation): TargetScenario[] {
  return strategy.targets.map((target, index) => ({
    label: target.label,
    scenario: index === 0 ? 'base' : index === 1 ? 'bullish' : 'extended-bullish',
    price: target.price,
    upsidePct: target.upsidePct,
    riskReward: target.netRewardRisk,
    timeframe: strategy.setupTimeframe,
    confidence: index === 0 ? 'High confluence' : index === 1 ? 'Moderate confluence' : 'Low confluence',
    justification: `${target.method}. Gross R/R ${target.grossRewardRisk}:1; estimated net R/R ${target.netRewardRisk}:1 after configured costs.`,
    conditions: strategy.setupConditions,
  }));
}

function calculatePositionSizing(input: InvestorPositionInput, entry: number, stop: StopLossPlan | null, executionCostPerShare: number, averageTradedValueCr: number | null, lotSize: number): PositionSizingResult | undefined {
  const capital = input.availableCapital ?? input.accountEquity;
  const equity = input.accountEquity ?? capital;
  if (!capital || !equity || input.acceptableRiskPct == null || !stop || entry <= stop.price) return undefined;
  const percentageRiskBudget = equity * input.acceptableRiskPct / 100;
  const remainingDailyRisk = input.maxDailyLoss == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, input.maxDailyLoss - (input.currentDailyLoss ?? 0));
  const riskAmount = Math.min(percentageRiskBudget, remainingDailyRisk);
  const riskPerShare = entry - stop.price;
  const effectiveRiskPerShare = riskPerShare + executionCostPerShare;
  const exposureCaps = [capital];
  if (input.maxStockAllocationPct != null) exposureCaps.push(equity * input.maxStockAllocationPct / 100);
  if (input.maxTotalExposurePct != null) exposureCaps.push(equity * Math.max(0, input.maxTotalExposurePct - (input.currentTotalExposurePct ?? 0)) / 100);
  if (input.maxSectorExposurePct != null) exposureCaps.push(equity * Math.max(0, input.maxSectorExposurePct - (input.currentSectorExposurePct ?? 0)) / 100);
  const liquidityCapitalLimit = averageTradedValueCr == null
    ? null
    : averageTradedValueCr * 10_000_000 * POSITION_SIZING_POLICY.maximumAverageDailyValueParticipationPct / 100;
  if (liquidityCapitalLimit != null) exposureCaps.push(liquidityCapitalLimit);
  const allocationCapital = Math.min(...exposureCaps);
  const normalizedLotSize = Math.max(1, Math.floor(lotSize));
  const toLot = (quantity: number) => Math.floor(Math.max(0, quantity) / normalizedLotSize) * normalizedLotSize;
  const affordable = toLot(Math.floor(allocationCapital / (entry + executionCostPerShare)));
  const riskQuantity = Math.floor(riskAmount / effectiveRiskPerShare);
  const blockedReasons = [
    ...(input.cooldownActive ? ['The user-reported trading cooldown is active.'] : []),
    ...(input.maxOpenPositions != null && input.currentOpenPositions != null && input.currentOpenPositions >= input.maxOpenPositions ? [`Current open positions (${input.currentOpenPositions}) meet or exceed the maximum (${input.maxOpenPositions}).`] : []),
    ...(input.maxConsecutiveLosses != null && input.currentConsecutiveLosses != null && input.currentConsecutiveLosses >= input.maxConsecutiveLosses ? [`Current consecutive losses (${input.currentConsecutiveLosses}) meet or exceed the maximum (${input.maxConsecutiveLosses}).`] : []),
    ...(remainingDailyRisk <= 0 ? ['The stated maximum daily loss has been fully consumed.'] : []),
    ...(allocationCapital <= 0 ? ['No exposure capacity remains under the supplied portfolio/sector limits.'] : []),
    ...(riskQuantity <= 0 ? ['The remaining risk budget does not support one instrument lot at the calculated stop distance and costs.'] : []),
    ...(affordable <= 0 ? ['Available/allocation capital does not support one instrument lot at the calculated entry and costs.'] : []),
  ];
  const quantity = blockedReasons.length ? 0 : toLot(Math.min(affordable, riskQuantity));
  const estimatedExecutionCosts = quantity * executionCostPerShare;
  const constraints = [
    `Risk-budget quantity before lot normalization: ${riskQuantity}.`,
    `Capital-constrained quantity: ${affordable}.`,
    `Instrument lot-size constraint: ${normalizedLotSize}.`,
    ...(input.maxDailyLoss != null ? [`Daily-loss cap ₹${input.maxDailyLoss.toLocaleString('en-IN')}; reported loss ₹${(input.currentDailyLoss ?? 0).toLocaleString('en-IN')}; remaining risk capacity ₹${remainingDailyRisk.toLocaleString('en-IN', { maximumFractionDigits: 2 })}. Percentage-based budget was ₹${percentageRiskBudget.toLocaleString('en-IN', { maximumFractionDigits: 2 })}.`] : []),
    ...(input.maxStockAllocationPct != null ? [`Per-stock allocation capped at ${input.maxStockAllocationPct}%.`] : []),
    ...(input.maxOpenPositions != null ? [`Maximum open positions: ${input.maxOpenPositions}; ${input.currentOpenPositions == null ? 'current count was not supplied and must be checked' : `current count ${input.currentOpenPositions}`}.`] : []),
    ...(input.maxConsecutiveLosses != null ? [`Maximum consecutive losses: ${input.maxConsecutiveLosses}; ${input.currentConsecutiveLosses == null ? 'current count was not supplied and must be checked' : `current count ${input.currentConsecutiveLosses}`}.`] : []),
    ...(input.maxTotalExposurePct != null ? [`Maximum total exposure ${input.maxTotalExposurePct}%; ${input.currentTotalExposurePct == null ? 'current exposure was not supplied, so quantity is an upper bound' : `current exposure ${input.currentTotalExposurePct}%`}.`] : []),
    ...(input.maxSectorExposurePct != null ? [`Maximum sector exposure ${input.maxSectorExposurePct}%; ${input.currentSectorExposurePct == null ? 'current exposure was not supplied, so quantity is an upper bound' : `current exposure ${input.currentSectorExposurePct}%`}.`] : []),
    ...(liquidityCapitalLimit != null ? [`Liquidity cap: ${POSITION_SIZING_POLICY.maximumAverageDailyValueParticipationPct}% of 20-session average traded value under ${POSITION_SIZING_POLICY.version}.`] : ['No reliable average traded value was available, so a quantity was not liquidity-capped.']),
  ];
  return { policyVersion: POSITION_SIZING_POLICY.version, capital, riskPct: input.acceptableRiskPct, riskAmount: roundMoney(riskAmount), riskPerShare: roundMoney(riskPerShare), quantity, capitalRequired: roundMoney(quantity * entry + estimatedExecutionCosts), estimatedExecutionCosts: roundMoney(estimatedExecutionCosts), estimatedMaximumPlannedLoss: roundMoney(quantity * effectiveRiskPerShare), blocked: blockedReasons.length > 0, blockedReasons, constraints, note: 'Quantity is capped by the user-supplied risk budget, loss/exposure policy, lot size, available capital and configured liquidity participation. Gap losses and market impact can exceed this estimate.' };
}

function buildExitStrategy(targets: TargetScenario[], stop: StopLossPlan | null, report: ResearchReport): string[] {
  return unique([
    targets[0] ? `At ${fmtPrice(targets[0].price)}, reassess momentum; partial profit protection may be considered rather than assuming higher targets will be reached.` : '',
    targets[1] ? `Beyond ${fmtPrice(targets[1].price)}, use a trailing structural stop if the trend remains intact.` : '',
    stop ? `A confirmed close below ${fmtPrice(stop.price)} triggers technical invalidation and thesis reassessment.` : '',
    'Reassess after every material quarterly result, guidance change, governance event or capital-allocation decision.',
    'If the expected catalyst does not develop within the selected horizon, compare opportunity cost and revalidate the thesis instead of waiting indefinitely.',
    report.risks.find((risk) => risk.severity === 'high') ? `Monitor high-severity risk: ${report.risks.find((risk) => risk.severity === 'high')!.risk ?? report.risks.find((risk) => risk.severity === 'high')!.category}.` : '',
  ].filter(Boolean));
}

function buildLimitations(report: ResearchReport, fundamentalCoverage: number, valuationCoverage: number, position: InvestorPositionInput) {
  const output = [
    `Fundamental score coverage: ${fundamentalCoverage}%; valuation score coverage: ${valuationCoverage}%. Missing fields were excluded, not estimated.`,
    'Targets and entry zones are conditional scenarios derived from observed price structure and volatility; they are not forecasts or guarantees.',
    'No calibrated probability is shown because the methodology has not completed broad out-of-sample validation.',
  ];
  if (!report.financials.annualTrend?.length) output.push('Verified 1/3/5-year financial series were not available in the current structured report, so no long-history growth score was invented.');
  if (!position.horizon) output.push('No trading horizon was supplied; the engine used a positional scenario. Intraday, swing and long-term levels require different candle structures and may differ materially.');
  if (position.ownsStock && (position.purchasePrice == null || position.horizon == null)) output.push('A personalized HOLD/REDUCE/EXIT assessment requires purchase price and investment horizon.');
  return output;
}

function mergePosition(previous: InvestorPositionInput | undefined, next: InvestorPositionInput): InvestorPositionInput {
  return { ...(previous ?? { ownsStock: false }), ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)), ownsStock: next.ownsStock || previous?.ownsStock || false };
}
function inferHorizon(query: string): InvestmentDecisionResult['horizon'] { return extractInvestorPosition(query).horizon ?? 'positional'; }
function midpoint(a: number, b: number) { return (a + b) / 2; }
function tickSize(technical: TechnicalAnalysisResult) { const raw = technical.instrument.tick_size; return raw && raw > 0 ? raw / 100 : 0.05; }
function roundToTick(value: number, tick: number) { return Math.round(Math.round(value / tick) * tick * 100) / 100; }
function roundPrice(value: number, technical: TechnicalAnalysisResult) { return Math.round(roundToTick(value, tickSize(technical)) * 100) / 100; }
function roundPct(value: number) { return Math.round(value * 100) / 100; }
function roundMoney(value: number) { return Math.round(value * 100) / 100; }
function fmt(value: number | null | undefined) { return value == null ? 'N/A' : value.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function fmtPrice(value: number) { return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`; }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function trimTechnical(result: TechnicalAnalysisResult): TechnicalAnalysisResult {
  const limit = 260;
  if (result.candles.length <= limit) return result;
  const start = result.candles.length - limit;
  return { ...result, candles: result.candles.slice(start), series: Object.fromEntries(Object.entries(result.series).map(([key, values]) => [key, values.slice(start)])) as unknown as TechnicalAnalysisResult['series'] };
}
