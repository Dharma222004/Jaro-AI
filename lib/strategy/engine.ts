import { createHash } from 'node:crypto';
import type { ResearchReport } from '@/types/research';
import type { TechnicalAnalysisResult } from '@/types/technical';
import type {
  MarketRegimeAnalysis,
  SectorStrengthAnalysis,
  StockStrengthAnalysis,
  StrategyEntryPlan,
  StrategyEvaluation,
  StrategyGate,
  StrategyScoreComponent,
  StrategyStopPlan,
  StrategyTarget,
  SystematicStrategyResult,
  TradeSetupStatus,
  TradingCostEstimate,
} from '@/types/strategy';
import { STRATEGY_CONFIGS, STRATEGY_POLICY_VERSION, type StrategyConfiguration } from './config';

export function runSystematicStrategyEngine(params: {
  report: ResearchReport;
  stockDaily: TechnicalAnalysisResult;
  stockWeekly: TechnicalAnalysisResult;
  benchmarkDaily: TechnicalAnalysisResult;
  benchmarkWeekly?: TechnicalAnalysisResult;
  sectorDaily?: TechnicalAnalysisResult | null;
  vixDaily?: TechnicalAnalysisResult | null;
  horizon: 'intraday' | 'swing' | 'positional' | 'long-term';
}): SystematicStrategyResult {
  const marketRegime = classifyMarketRegime(params.benchmarkDaily, params.benchmarkWeekly, params.vixDaily ?? null);
  const sectorStrength = classifySectorStrength(params.report.company.sector ?? 'Unknown', params.sectorDaily ?? null, params.benchmarkDaily);
  const stockStrength = analyseStockStrength(params.stockDaily, params.benchmarkDaily, params.sectorDaily ?? null);
  const generatedAt = new Date().toISOString();

  if (params.horizon === 'long-term' || params.horizon === 'intraday') {
    const status: TradeSetupStatus = params.horizon === 'intraday' ? 'INSUFFICIENT_MARKET_DATA' : 'NO_VALID_SETUP';
    const reason = params.horizon === 'intraday'
      ? 'The first systematic release requires a validated 5-minute trigger and spread/liquidity feed; daily playbooks are not relabelled as intraday setups.'
      : 'Long-term investment accumulation is evaluated through business quality and valuation, not short-term trade targets.';
    const strategies = (Object.keys(STRATEGY_CONFIGS) as Array<keyof typeof STRATEGY_CONFIGS>).map((id) => unavailableEvaluation(id, status, reason, params.stockDaily, marketRegime, sectorStrength, stockStrength, params.horizon));
    return { selected: null, strategies, marketRegime, sectorStrength, stockStrength, generatedAt, benchmark: compactBenchmark(params.benchmarkDaily) };
  }

  const common = { ...params, marketRegime, sectorStrength, stockStrength };
  const strategies = [evaluateTrendPullback(common), evaluateBreakoutRetest(common)];
  const selected = [...strategies].sort(compareStrategies)[0] ?? null;
  return {
    selected: selected && selected.status !== 'INSUFFICIENT_MARKET_DATA' ? selected : null,
    strategies,
    marketRegime,
    sectorStrength,
    stockStrength,
    generatedAt,
    benchmark: compactBenchmark(params.benchmarkDaily),
  };
}

type CommonInput = Parameters<typeof runSystematicStrategyEngine>[0] & {
  marketRegime: MarketRegimeAnalysis;
  sectorStrength: SectorStrengthAnalysis;
  stockStrength: StockStrengthAnalysis;
};

function evaluateTrendPullback(input: CommonInput): StrategyEvaluation {
  const config = STRATEGY_CONFIGS.trend_pullback_continuation;
  const stock = input.stockDaily;
  const latest = stock.candles.at(-1);
  const previous = stock.candles.at(-2);
  const indicator = stock.indicators;
  const missing = requiredMissing(stock, ['sma200', 'sma50', 'ema20', 'ema50', 'atr14', 'rsi14', 'macdHistogram']);
  if (!latest || !previous || missing.length) return unavailableEvaluation(config.id, 'INSUFFICIENT_MARKET_DATA', `Missing required inputs: ${missing.join(', ') || 'candles'}.`, stock, input.marketRegime, input.sectorStrength, input.stockStrength, input.horizon);

  const atr = indicator.atr14!;
  const observed = stock.quote?.lastPrice ?? latest.close;
  const sma50Rising = seriesDirection(stock.series.sma50, 20) === 'rising';
  const positiveStructure = latest.close > indicator.sma200! && sma50Rising && indicator.ema20! > indicator.ema50! && input.stockWeekly.trend !== 'bearish';
  const anchors = [indicator.ema20, indicator.ema50, indicator.support, indicator.swingLow]
    .filter((value): value is number => value != null && value > 0 && value <= latest.close)
    .sort((a, b) => b - a);
  const anchor = anchors[0] ?? indicator.ema20!;
  const distanceAtr = Math.abs(latest.close - anchor) / atr;
  const normalPullback = distanceAtr <= 1.05 && latest.close >= indicator.sma50! - atr * .35;
  const closeLocation = (latest.close - latest.low) / Math.max(.01, latest.high - latest.low);
  const bullishCandle = latest.close > latest.open && closeLocation >= .62;
  const higherLow = indicator.swingLow != null && latest.low >= indicator.swingLow;
  const tick = tickSize(stock);
  const zoneLow = roundTick(anchor - atr * config.entryBufferAtr, tick);
  const zoneHigh = roundTick(anchor + atr * config.entryBufferAtr, tick);
  const triggerPrice = roundTick(Math.max(previous.high, zoneHigh), tick);
  const maximumEntryPrice = roundTick(triggerPrice + atr * config.maximumEntryExtensionAtr, tick);
  const histogram = recentValues(stock.series.macdHistogram, 2);
  const macdImproving = histogram.length >= 2 && histogram.at(-1)! >= histogram.at(-2)!;
  const momentumConfirmed = indicator.rsi14! >= 40 && indicator.rsi14! <= 75 && ((indicator.macdHistogram ?? 0) >= 0 || macdImproving);
  const triggerConfirmed = latest.close >= triggerPrice && bullishCandle && higherLow && momentumConfirmed && (indicator.relativeVolume ?? 0) >= config.confirmationVolumeRatio;
  const extended = observed > maximumEntryPrice;
  const structuralReference = nearestBelow([indicator.swingLow, indicator.support, indicator.ema50], zoneLow) ?? zoneLow - atr;
  const stop = buildStop(triggerPrice, structuralReference, atr, config, stock);
  const entry = buildEntry('Pullback support zone', zoneLow, zoneHigh, triggerPrice, maximumEntryPrice, observed, 'A daily bullish close above the trigger after support holds.', stock, config, extended);
  const costs = stop ? estimateCosts(triggerPrice, config) : null;
  const targets = stop && costs ? buildTargets(triggerPrice, stop, [indicator.resistance, indicator.swingHigh, input.stockWeekly.indicators.resistance], config, costs, tick) : [];
  const riskFilters = eventRiskFilters(input.report, input.marketRegime, input.sectorStrength, input.stockStrength);
  const liquidityPass = (input.stockStrength.averageTradedValueCr ?? 0) >= config.minimumDailyTradedValueCr;

  const gates: StrategyGate[] = [
    instrumentGate(stock),
    validatedDataGate(stock),
    gate('trend', 'Higher-timeframe uptrend', positiveStructure, `Close ${fmt(latest.close)} vs SMA200 ${fmt(indicator.sma200)}; SMA50 ${sma50Rising ? 'rising' : 'not rising'}; weekly ${input.stockWeekly.trend}.`, true),
    gate('market', 'Market alignment', !['bearish', 'high-volatility', 'uncertain'].includes(input.marketRegime.classification), `Market regime: ${input.marketRegime.classification}.`, true),
    gate('liquidity', 'Liquidity', liquidityPass, `Average traded value ${fmt(input.stockStrength.averageTradedValueCr)} Cr; strategy minimum ${config.minimumDailyTradedValueCr} Cr.`, true),
    gate('pullback', 'Normal pullback into support', normalPullback, `Distance to nearest support/EMA: ${distanceAtr.toFixed(2)} ATR.`, true, normalPullback ? 'pass' : distanceAtr > 1.05 ? 'pending' : 'fail'),
    gate('momentum', 'Momentum confirmation', momentumConfirmed, `RSI(14) ${fmt(indicator.rsi14)}; MACD histogram ${fmt(indicator.macdHistogram)}; histogram ${macdImproving ? 'improving' : 'not improving'}.`, true, momentumConfirmed ? 'pass' : 'pending'),
    gate('confirmation', 'Renewed buying confirmation', triggerConfirmed, `Close ${fmt(latest.close)} vs trigger ${fmt(triggerPrice)}; bullish candle: ${bullishCandle}; higher low: ${higherLow}; relative volume ${fmt(indicator.relativeVolume)}x.`, true, triggerConfirmed ? 'pass' : 'pending'),
    gate('stop', 'Structural stop available', Boolean(stop), stop?.reason ?? 'No structural stop could be established.', true),
    rewardRiskGate(targets, config),
    eventCalendarGate(),
    sectorGate(input.sectorStrength),
  ];
  const status = statusForPullback({ positiveStructure, normalPullback, triggerConfirmed, extended, stop, targets, missing, config });
  return finalizeEvaluation({
    config,
    name: 'Trend Pullback Continuation',
    status,
    horizon: input.horizon,
    stock,
    marketRegime: input.marketRegime,
    sectorStrength: input.sectorStrength,
    stockStrength: input.stockStrength,
    gates,
    entry,
    stop,
    targets,
    costs,
    setupConditions: ['Daily and weekly trend remain constructive.', 'Pullback holds a validated EMA/support zone.', `A bullish daily close at or above ${fmt(triggerPrice)} confirms renewed demand.`, `RSI/MACD momentum is supportive and relative volume is at least ${config.confirmationVolumeRatio.toFixed(2)}x.`],
    invalidationConditions: [stop ? `Daily close below ${fmt(stop.price)}.` : 'No stop available.', 'Weekly trend turns bearish.', 'Material company event invalidates the fundamental risk filter.'],
    riskFilters,
    missingData: eventMissingData(input),
    methodology: [`Strategy ${config.version}.`, 'Long-side NSE cash-equity research.', 'Support/EMA confluence with ATR-normalized pullback.', 'Confirmation requires price action plus volume; RSI alone is never sufficient.'],
  });
}

function evaluateBreakoutRetest(input: CommonInput): StrategyEvaluation {
  const config = STRATEGY_CONFIGS.breakout_retest;
  const stock = input.stockDaily;
  const candles = stock.candles;
  const latest = candles.at(-1);
  const indicator = stock.indicators;
  const missing = requiredMissing(stock, ['atr14', 'sma200', 'relativeVolume']);
  if (!latest || candles.length < 80 || missing.length) return unavailableEvaluation(config.id, 'INSUFFICIENT_MARKET_DATA', `Missing required inputs: ${missing.join(', ') || 'historical candles'}.`, stock, input.marketRegime, input.sectorStrength, input.stockStrength, input.horizon);
  const atr = indicator.atr14!;
  const observed = stock.quote?.lastPrice ?? latest.close;
  const resistance = Math.max(...candles.slice(-65, -10).map((candle) => candle.high));
  const breakoutWindow = candles.slice(-10);
  const breakoutOffset = breakoutWindow.findIndex((candle, index) => {
    const absolute = candles.length - breakoutWindow.length + index;
    return candle.close > resistance && relativeVolumeAt(candles, absolute) >= config.confirmationVolumeRatio;
  });
  const breakoutIndex = breakoutOffset >= 0 ? candles.length - breakoutWindow.length + breakoutOffset : -1;
  const breakout = breakoutIndex >= 0 ? candles[breakoutIndex] : null;
  const afterBreakout = breakoutIndex >= 0 ? candles.slice(breakoutIndex + 1) : [];
  const retest = afterBreakout.find((candle) => candle.low <= resistance + atr * .45 && candle.close >= resistance - atr * .1) ?? null;
  const previous = candles.at(-2)!;
  const renewedBuying = Boolean(retest && latest.close > previous.high && latest.close > latest.open);
  const tick = tickSize(stock);
  const zoneLow = roundTick(resistance - atr * .12, tick);
  const zoneHigh = roundTick(resistance + atr * .25, tick);
  const triggerPrice = roundTick(previous.high, tick);
  const maximumEntryPrice = roundTick(resistance + atr * config.maximumEntryExtensionAtr, tick);
  const extended = observed > maximumEntryPrice || triggerPrice > maximumEntryPrice;
  const structuralReference = Math.min(retest?.low ?? resistance, resistance);
  const stop = breakout ? buildStop(triggerPrice, structuralReference, atr, config, stock) : null;
  const entry = buildEntry('Retest support zone', zoneLow, zoneHigh, triggerPrice, maximumEntryPrice, observed, 'A close above the confirmation trigger after former resistance holds as support.', stock, config, extended);
  const costs = stop ? estimateCosts(triggerPrice, config) : null;
  const supplyLevels = swingHighs(candles, config.pivotWindow).filter((price) => price > triggerPrice);
  const targets = stop && costs ? buildTargets(triggerPrice, stop, [...supplyLevels, input.stockWeekly.indicators.resistance], config, costs, tick) : [];
  const breakoutStrengthAtr = breakout ? (breakout.close - resistance) / atr : 0;
  const marketAligned = !['bearish', 'high-volatility', 'uncertain'].includes(input.marketRegime.classification);
  const stockTrendAligned = latest.close > indicator.sma200! && input.stockWeekly.trend !== 'bearish' && (input.stockStrength.relativeToNiftyPct ?? -100) >= -2;
  const liquidityPass = (input.stockStrength.averageTradedValueCr ?? 0) >= config.minimumDailyTradedValueCr;
  const gates: StrategyGate[] = [
    instrumentGate(stock),
    validatedDataGate(stock),
    gate('trend', 'Stock trend and relative strength', stockTrendAligned, `Close ${fmt(latest.close)} vs SMA200 ${fmt(indicator.sma200)}; weekly ${input.stockWeekly.trend}; relative to NIFTY ${fmt(input.stockStrength.relativeToNiftyPct)} points.`, true),
    gate('resistance', 'Meaningful resistance identified', Number.isFinite(resistance) && resistance > 0, `65-to-10 bar range high: ${fmt(resistance)}.`, true),
    gate('breakout', 'Close and volume-confirmed breakout', Boolean(breakout), breakout ? `Breakout close ${fmt(breakout.close)}; ${breakoutStrengthAtr.toFixed(2)} ATR above resistance.` : `No close above ${fmt(resistance)} with ${config.confirmationVolumeRatio}x volume.`, true, breakout ? 'pass' : 'pending'),
    gate('retest', 'Successful retest', Boolean(retest), retest ? `Retest low ${fmt(retest.low)} and close ${fmt(retest.close)}.` : 'Former resistance has not yet been retested successfully.', true, retest ? 'pass' : 'pending'),
    gate('confirmation', 'Renewed buying after retest', renewedBuying, renewedBuying ? 'Latest close reclaimed the previous high after retest.' : 'Waiting for a bullish close above the confirmation trigger.', true, renewedBuying ? 'pass' : 'pending'),
    gate('market', 'Market alignment', marketAligned, `Market regime: ${input.marketRegime.classification}.`, true),
    gate('liquidity', 'Liquidity', liquidityPass, `Average traded value ${fmt(input.stockStrength.averageTradedValueCr)} Cr; strategy minimum ${config.minimumDailyTradedValueCr} Cr.`, true),
    gate('stop', 'Retest invalidation stop', Boolean(stop), stop?.reason ?? 'No breakout structure exists for a stop.', true),
    rewardRiskGate(targets, config),
    eventCalendarGate(),
    sectorGate(input.sectorStrength),
  ];
  const status: TradeSetupStatus = !breakout ? 'BREAKOUT_NOT_CONFIRMED'
    : extended ? 'PRICE_EXTENDED_DO_NOT_CHASE'
      : !retest || !renewedBuying ? 'WAIT_FOR_CONFIRMATION'
        : stop && targets[0]?.netRewardRisk >= config.minimumNetRewardRisk && marketAligned && stockTrendAligned && liquidityPass ? 'ENTRY_AVAILABLE'
          : 'NO_VALID_SETUP';
  return finalizeEvaluation({
    config,
    name: 'Breakout and Retest',
    status,
    horizon: input.horizon,
    stock,
    marketRegime: input.marketRegime,
    sectorStrength: input.sectorStrength,
    stockStrength: input.stockStrength,
    gates,
    entry,
    stop,
    targets,
    costs,
    setupConditions: [`Daily close above ${fmt(resistance)}.`, `Breakout relative volume at least ${config.confirmationVolumeRatio}x.`, 'Former resistance holds during a retest.', 'A subsequent bullish close confirms renewed demand.'],
    invalidationConditions: [stop ? `Close below ${fmt(stop.price)}.` : 'No valid stop available.', 'Immediate failure back into the prior range.', 'Market regime turns bearish or high-volatility.'],
    riskFilters: eventRiskFilters(input.report, input.marketRegime, input.sectorStrength, input.stockStrength),
    missingData: eventMissingData(input),
    methodology: [`Strategy ${config.version}.`, 'Resistance uses a fixed historical range ending before the recent breakout window.', 'Intraday excursions do not qualify; a close and relative-volume threshold are required.', 'Entry requires a retest and renewed buying confirmation.'],
  });
}

export function classifyMarketRegime(daily: TechnicalAnalysisResult, weekly?: TechnicalAnalysisResult, vix?: TechnicalAnalysisResult | null): MarketRegimeAnalysis {
  const latest = daily.candles.at(-1)?.close ?? null;
  const i = daily.indicators;
  const above50 = latest != null && i.sma50 != null ? latest > i.sma50 : null;
  const above200 = latest != null && i.sma200 != null ? latest > i.sma200 : null;
  const direction = seriesDirection(daily.series.sma50, 20);
  const vixValue = vix?.quote?.lastPrice ?? vix?.candles.at(-1)?.close ?? null;
  const volatilityState = vixValue == null ? 'unavailable' : vixValue >= 25 ? 'high' : vixValue >= 19 ? 'elevated' : 'normal';
  const bullish = above50 === true && above200 === true && direction !== 'falling' && daily.trend === 'bullish' && weekly?.trend !== 'bearish';
  const bearish = above50 === false && above200 === false && direction === 'falling' && daily.trend === 'bearish';
  const weakening = above200 === true && (above50 === false || direction === 'falling' || (i.macdHistogram ?? 0) < 0);
  const classification = volatilityState === 'high' ? 'high-volatility' : bullish ? 'bullish' : bearish ? 'bearish' : weakening ? 'weakening' : daily.trend === 'sideways' ? 'sideways' : 'uncertain';
  const scoreParts = [above50 == null ? null : above50 ? 1 : 0, above200 == null ? null : above200 ? 1 : 0, direction === 'unavailable' ? null : direction === 'rising' ? 1 : direction === 'flat' ? .5 : 0, daily.trend === 'bullish' ? 1 : daily.trend === 'sideways' ? .5 : 0, weekly ? weekly.trend === 'bullish' ? 1 : weekly.trend === 'sideways' ? .5 : 0 : null].filter((value): value is number => value != null);
  return {
    classification,
    score: scoreParts.length ? Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length * 100) : null,
    niftyTrend: `${daily.trend}${weekly ? ` / weekly ${weekly.trend}` : ''}`,
    niftyAboveSma50: above50,
    niftyAboveSma200: above200,
    sma50Direction: direction,
    structure: i.structure,
    vix: vixValue,
    volatilityState,
    breadthStatus: 'unavailable',
    reasoning: [`NIFTY close ${fmt(latest)}; SMA50 ${fmt(i.sma50)}; SMA200 ${fmt(i.sma200)}.`, `SMA50 direction is ${direction}; structure is ${i.structure}.`, vixValue == null ? 'INDIA VIX was unavailable.' : `INDIA VIX is ${fmt(vixValue)} (${volatilityState}).`, 'Reliable broad-market breadth was not available and was not inferred.'],
    timestamp: daily.lastCandleAt,
  };
}

export function classifySectorStrength(sector: string, sectorTechnical: TechnicalAnalysisResult | null, benchmark: TechnicalAnalysisResult): SectorStrengthAnalysis {
  const indexName = sectorTechnical?.instrument.name ?? null;
  if (!sectorTechnical) return { sector, indexName, classification: 'unavailable', sectorReturnPct: null, benchmarkReturnPct: returnPct(benchmark.candles, 63), relativeReturnPct: null, trend: null, reasoning: ['No supported sector index mapping/data was available; sector strength was not invented.'] };
  const sectorReturn = returnPct(sectorTechnical.candles, 63);
  const benchmarkReturn = returnPct(benchmark.candles, 63);
  const relative = sectorReturn != null && benchmarkReturn != null ? sectorReturn - benchmarkReturn : null;
  const classification = relative == null ? 'unavailable' : relative >= 5 && sectorTechnical.trend === 'bullish' ? 'leading' : relative >= 1 ? 'improving' : relative <= -5 ? 'underperforming' : relative <= -1 ? 'weakening' : 'neutral';
  return { sector, indexName, classification, sectorReturnPct: round(sectorReturn), benchmarkReturnPct: round(benchmarkReturn), relativeReturnPct: round(relative), trend: sectorTechnical.trend, reasoning: [`63-period sector return ${fmt(sectorReturn)}% versus NIFTY ${fmt(benchmarkReturn)}%.`, `Relative performance ${fmt(relative)} percentage points; sector trend ${sectorTechnical.trend}.`] };
}

export function analyseStockStrength(stock: TechnicalAnalysisResult, benchmark: TechnicalAnalysisResult, sector: TechnicalAnalysisResult | null): StockStrengthAnalysis {
  const stockReturn = returnPct(stock.candles, 63);
  const benchmarkReturn = returnPct(benchmark.candles, 63);
  const sectorReturn = sector ? returnPct(sector.candles, 63) : null;
  const averageTradedValueCr = average(stock.candles.slice(-20).map((candle) => candle.close * candle.volume)) / 10_000_000;
  const relativeToNifty = stockReturn != null && benchmarkReturn != null ? stockReturn - benchmarkReturn : null;
  const relativeToSector = stockReturn != null && sectorReturn != null ? stockReturn - sectorReturn : null;
  const liquidity = !Number.isFinite(averageTradedValueCr) ? 'unavailable' : averageTradedValueCr >= 8 ? 'sufficient' : averageTradedValueCr >= 3 ? 'limited' : 'insufficient';
  return { stockReturnPct: round(stockReturn), relativeToNiftyPct: round(relativeToNifty), relativeToSectorPct: round(relativeToSector), averageTradedValueCr: round(averageTradedValueCr), relativeVolume: stock.indicators.relativeVolume, atrPct: stock.indicators.atrPct, liquidity, spreadPct: null, reasoning: [`63-period stock return ${fmt(stockReturn)}%; relative to NIFTY ${fmt(relativeToNifty)} points.`, sector ? `Relative to sector ${fmt(relativeToSector)} points.` : 'Sector-relative return unavailable.', `20-session average traded value approximately ₹${fmt(averageTradedValueCr)} Cr.`, 'Bid-ask spread was unavailable from the validated snapshot and was not estimated.'] };
}

function finalizeEvaluation(params: { config: StrategyConfiguration; name: string; status: TradeSetupStatus; horizon: 'intraday' | 'swing' | 'positional' | 'long-term'; stock: TechnicalAnalysisResult; marketRegime: MarketRegimeAnalysis; sectorStrength: SectorStrengthAnalysis; stockStrength: StockStrengthAnalysis; gates: StrategyGate[]; entry: StrategyEntryPlan | null; stop: StrategyStopPlan | null; targets: StrategyTarget[]; costs: TradingCostEstimate | null; setupConditions: string[]; invalidationConditions: string[]; riskFilters: string[]; missingData: string[]; methodology: string[] }): StrategyEvaluation {
  const scoreComponents = components(params);
  const available = scoreComponents.filter((component) => component.value != null);
  const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);
  const totalWeight = scoreComponents.reduce((sum, component) => sum + component.weight, 0);
  const score = availableWeight ? Math.round(available.reduce((sum, component) => sum + component.value! * component.weight, 0) / availableWeight) : null;
  const mandatoryPass = params.gates.filter((gate) => gate.mandatory).every((gate) => gate.status === 'pass');
  const rulesQualified = params.status === 'ENTRY_AVAILABLE' && mandatoryPass;
  return {
    strategyId: params.config.id,
    strategyName: params.name,
    strategyVersion: params.config.version,
    releaseStatus: params.config.releaseStatus,
    status: params.status,
    rulesQualified,
    eligible: params.config.releaseStatus === 'validated' && rulesQualified,
    horizon: params.horizon === 'swing' ? 'swing' : params.horizon === 'intraday' ? 'intraday' : 'positional',
    setupTimeframe: params.stock.timeframe,
    confirmationTimeframe: params.stock.timeframe,
    detectedAt: new Date().toISOString(),
    marketRegime: params.marketRegime,
    sectorStrength: params.sectorStrength,
    stockStrength: params.stockStrength,
    gates: params.gates,
    score,
    scoreCoveragePct: totalWeight ? Math.round(availableWeight / totalWeight * 100) : 0,
    scoreComponents,
    entry: params.entry,
    stop: params.stop,
    targets: params.targets,
    costs: params.costs,
    setupConditions: params.setupConditions,
    invalidationConditions: params.invalidationConditions,
    riskFilters: params.riskFilters,
    missingData: params.missingData,
    methodology: [...params.methodology, `Release status: ${params.config.releaseStatus}.`, `Policy ${STRATEGY_POLICY_VERSION}.`],
    audit: { instrumentKey: params.stock.instrument.instrument_key, candleCount: params.stock.candles.length, lastCandleAt: params.stock.lastCandleAt, marketDataStatus: params.stock.dataStatus, inputsHash: inputHash(params.stock, params.config, { marketRegime: params.marketRegime, sectorStrength: params.sectorStrength, stockStrength: params.stockStrength, gates: params.gates, riskFilters: params.riskFilters }) },
  };
}

function components(params: Parameters<typeof finalizeEvaluation>[0]): StrategyScoreComponent[] {
  const gateValue = (id: string) => { const status = params.gates.find((gate) => gate.id === id)?.status; return status === 'pass' ? 100 : status === 'pending' ? 50 : status === 'fail' ? 0 : null; };
  return [
    scoreComponent('data', 'Data quality', gateValue('data'), 10, params.stock.dataStatus),
    scoreComponent('market', 'Market alignment', gateValue('market'), 15, params.marketRegime.classification),
    scoreComponent('sector', 'Sector strength', sectorScore(params.sectorStrength.classification), 10, params.sectorStrength.classification),
    scoreComponent('trend', 'Stock trend', gateValue('trend') ?? gateValue('breakout'), 20, params.stock.trend),
    scoreComponent('setup', 'Setup quality', gateValue('pullback') ?? gateValue('retest'), 20, params.status),
    scoreComponent('confirmation', 'Entry confirmation', gateValue('confirmation'), 15, params.setupConditions.join(' ')),
    scoreComponent('liquidity', 'Liquidity', gateValue('liquidity'), 10, params.stockStrength.liquidity),
    scoreComponent('reward-risk', 'Net reward/risk', gateValue('reward-risk'), 10, params.targets.map((target) => `${target.label} ${target.netRewardRisk}:1`).join(', ')),
    scoreComponent('event-risk', 'Event-risk coverage', gateValue('event-calendar'), 10, 'Reliable earnings and corporate-event calendar coverage'),
  ];
}

function unavailableEvaluation(id: keyof typeof STRATEGY_CONFIGS, status: TradeSetupStatus, reason: string, stock: TechnicalAnalysisResult, marketRegime: MarketRegimeAnalysis, sectorStrength: SectorStrengthAnalysis, stockStrength: StockStrengthAnalysis, horizon: string): StrategyEvaluation {
  const config = STRATEGY_CONFIGS[id];
  return { strategyId: id, strategyName: id === 'trend_pullback_continuation' ? 'Trend Pullback Continuation' : 'Breakout and Retest', strategyVersion: config.version, releaseStatus: config.releaseStatus, status, rulesQualified: false, eligible: false, horizon: horizon === 'intraday' ? 'intraday' : horizon === 'swing' ? 'swing' : 'positional', setupTimeframe: stock.timeframe, confirmationTimeframe: stock.timeframe, detectedAt: new Date().toISOString(), marketRegime, sectorStrength, stockStrength, gates: [{ id: 'data', label: 'Required strategy inputs', status: 'unavailable', reason, mandatory: true }], score: null, scoreCoveragePct: 0, scoreComponents: [], entry: null, stop: null, targets: [], costs: null, setupConditions: [], invalidationConditions: [], riskFilters: [], missingData: [reason], methodology: [`Strategy ${config.version}.`, `Release status: ${config.releaseStatus}.`, `Policy ${STRATEGY_POLICY_VERSION}.`], audit: { instrumentKey: stock.instrument.instrument_key, candleCount: stock.candles.length, lastCandleAt: stock.lastCandleAt, marketDataStatus: stock.dataStatus, inputsHash: inputHash(stock, config, { marketRegime, sectorStrength, stockStrength, reason }) } };
}

function buildEntry(zoneLabel: StrategyEntryPlan['zoneLabel'], low: number, high: number, trigger: number, maximum: number, observed: number, condition: string, stock: TechnicalAnalysisResult, config: StrategyConfiguration, extended: boolean): StrategyEntryPlan {
  const expiryDate = new Date(new Date(stock.lastCandleAt ?? stock.retrievedAt).getTime() + config.maximumHoldingBars * 86_400_000);
  return { zoneLabel, zoneLow: low, zoneHigh: high, triggerPrice: trigger, triggerCondition: condition, maximumEntryPrice: maximum, observedPrice: observed, confirmationTimeframe: stock.timeframe, expiry: `${config.maximumHoldingBars} bars or ${expiryDate.toISOString().slice(0, 10)}, whichever occurs first`, extended };
}

function buildStop(entry: number, structure: number, atr: number, config: StrategyConfiguration, stock: TechnicalAnalysisResult): StrategyStopPlan | null {
  const atrBuffer = atr * config.stopAtrMultiplier;
  const price = roundTick(structure - atrBuffer, tickSize(stock));
  const risk = entry - price;
  if (!(price > 0 && price < entry && risk >= atr * .5)) return null;
  return { price, structuralReference: structure, atrBuffer: round(atrBuffer)!, atrMultiplier: config.stopAtrMultiplier, riskPerShare: round(risk)!, downsidePct: round(risk / entry * 100)!, reason: `Structure ${fmt(structure)} minus ${config.stopAtrMultiplier} ATR (${fmt(atrBuffer)}).`, gapRisk: 'A stop trigger does not guarantee execution at the stated price; gaps, circuits, spread and slippage can increase realized loss.' };
}

function buildTargets(entry: number, stop: StrategyStopPlan, structural: Array<number | null | undefined>, config: StrategyConfiguration, costs: TradingCostEstimate, tick: number): StrategyTarget[] {
  const risk = entry - stop.price;
  if (risk <= 0) return [];
  const candidates = structural.filter((value): value is number => value != null && value > entry)
    .map((price) => ({ price, method: 'Observed resistance / swing supply' }));
  for (const multiple of config.targetRiskMultiples) candidates.push({ price: entry + risk * multiple, method: `${multiple}R volatility-adjusted objective` });
  const unique = [...new Map(candidates.sort((a, b) => a.price - b.price).map((candidate) => [roundTick(candidate.price, tick), candidate])).entries()]
    .map(([price, candidate]) => ({ price, method: candidate.method }))
    .filter((candidate) => candidate.price > entry)
    .slice(0, 3);
  return unique.map((candidate, index) => {
    const reward = candidate.price - entry;
    const gross = reward / risk;
    const netReward = reward - costs.estimatedPerShareCost;
    const netRisk = risk + costs.estimatedPerShareCost;
    return { label: `Target ${index + 1}` as StrategyTarget['label'], price: candidate.price, method: candidate.method, grossRewardRisk: round(gross)!, netRewardRisk: round(netReward / netRisk)!, upsidePct: round(reward / entry * 100)! };
  });
}

function estimateCosts(entry: number, config: StrategyConfiguration): TradingCostEstimate {
  const totalBps = config.buyCostBps + config.sellCostBps + config.slippageBpsPerSide * 2;
  return { buyCostBps: config.buyCostBps, sellCostBps: config.sellCostBps, slippageBpsPerSide: config.slippageBpsPerSide, estimatedRoundTripCost: totalBps, estimatedPerShareCost: round(entry * totalBps / 10_000)!, assumptions: ['Cash-equity research estimate only.', 'Includes configured statutory/transaction allowance and two-sided slippage.', 'Does not estimate market impact; actual charges can differ by broker, product and regulation.'] };
}

function rewardRiskGate(targets: StrategyTarget[], config: StrategyConfiguration): StrategyGate {
  const nearest = targets[0]?.netRewardRisk ?? 0;
  return gate('reward-risk', 'Minimum net reward/risk', nearest >= config.minimumNetRewardRisk, `Nearest supported target net reward/risk ${nearest.toFixed(2)}:1; policy minimum ${config.minimumNetRewardRisk}:1.`, true);
}
function validatedDataGate(stock: TechnicalAnalysisResult): StrategyGate { const received = stock.validation.received; const acceptanceRatio = received > 0 ? stock.validation.accepted / received : 0; const missingLimit = Math.max(5, Math.floor(stock.validation.accepted * .02)); const pass = stock.validation.accepted >= 200 && acceptanceRatio >= .98 && stock.validation.estimatedMissingIntervals <= missingLimit && isFreshStatus(stock.dataStatus); return gate('data', 'Validated market data', pass, `Accepted ${stock.validation.accepted}/${received} candles; estimated missing intervals ${stock.validation.estimatedMissingIntervals}; status ${stock.dataStatus}.`, true); }
function instrumentGate(stock: TechnicalAnalysisResult): StrategyGate { const verified = Boolean(stock.instrument.instrument_key && ['NSE', 'BSE'].includes(stock.instrument.exchange) && stock.instrument.instrument_type === 'EQ'); return gate('instrument', 'Verified cash-equity mapping', verified, verified ? `${stock.instrument.exchange}:${stock.instrument.trading_symbol} resolved to ${stock.instrument.instrument_key}.` : 'A verified NSE/BSE cash-equity instrument mapping was not available.', true); }
function eventCalendarGate(): StrategyGate { return { id: 'event-calendar', label: 'Earnings and corporate-event calendar', status: 'unavailable', reason: 'A reliable forward earnings/corporate-event calendar was unavailable; verify material event timing before any execution.', mandatory: true }; }
function sectorGate(sector: SectorStrengthAnalysis): StrategyGate { return { id: 'sector', label: 'Sector alignment', status: sector.classification === 'unavailable' ? 'unavailable' : ['underperforming', 'weakening'].includes(sector.classification) ? 'pending' : 'pass', reason: `Sector classification: ${sector.classification}.`, value: sector.relativeReturnPct, mandatory: false }; }
function gate(id: string, label: string, pass: boolean, reason: string, mandatory: boolean, override?: StrategyGate['status']): StrategyGate { return { id, label, status: override ?? (pass ? 'pass' : 'fail'), reason, mandatory }; }
function statusForPullback(input: { positiveStructure: boolean; normalPullback: boolean; triggerConfirmed: boolean; extended: boolean; stop: StrategyStopPlan | null; targets: StrategyTarget[]; missing: string[]; config: StrategyConfiguration }): TradeSetupStatus {
  if (input.missing.length) return 'INSUFFICIENT_MARKET_DATA';
  if (!input.positiveStructure) return 'NO_VALID_SETUP';
  if (input.extended) return 'PRICE_EXTENDED_DO_NOT_CHASE';
  if (!input.normalPullback) return 'WAIT_FOR_PULLBACK';
  if (!input.triggerConfirmed) return 'WAIT_FOR_CONFIRMATION';
  if (!input.stop || (input.targets[0]?.netRewardRisk ?? 0) < input.config.minimumNetRewardRisk) return 'NO_VALID_SETUP';
  return 'ENTRY_AVAILABLE';
}
function eventRiskFilters(report: ResearchReport, market: MarketRegimeAnalysis, sector: SectorStrengthAnalysis, stock: StockStrengthAnalysis) { const output = [`Market regime: ${market.classification}.`, `Sector strength: ${sector.classification}.`, `Liquidity: ${stock.liquidity}.`]; if (report.recentDevelopments.some((event) => /result|earnings|regulatory|corporate action/i.test(`${event.category} ${event.headline}`))) output.push('Recent results/regulatory/corporate development exists; verify timing before execution.'); if ((stock.atrPct ?? 0) > 5) output.push('ATR exceeds 5% of price; volatility risk is elevated.'); return output; }
function eventMissingData(input: CommonInput) { const missing = ['Reliable earnings/corporate-event calendar was not available.', 'Bid-ask spread and market-impact data were not available.']; if (input.sectorStrength.classification === 'unavailable') missing.push('Supported sector-index data was unavailable.'); if (input.marketRegime.breadthStatus === 'unavailable') missing.push('Reliable market breadth was unavailable.'); return missing; }
function requiredMissing(stock: TechnicalAnalysisResult, fields: Array<keyof TechnicalAnalysisResult['indicators']>) { return fields.filter((field) => stock.indicators[field] == null).map(String); }
// `historical` can still be the latest completed daily/weekly candle while the market is closed.
// The upstream requireFresh check enforces timeframe-specific age limits before strategy evaluation.
function isFreshStatus(status: string) { return status !== 'stale-cache'; }
function seriesDirection(series: Array<{ value: number | null }>, lookback: number): MarketRegimeAnalysis['sma50Direction'] { const values = series.filter((point) => point.value != null).map((point) => point.value!); if (values.length <= lookback) return 'unavailable'; const change = (values.at(-1)! / values.at(-(lookback + 1))! - 1) * 100; return change > .5 ? 'rising' : change < -.5 ? 'falling' : 'flat'; }
function returnPct(candles: TechnicalAnalysisResult['candles'], periods: number) { if (candles.length <= periods) return null; const current = candles.at(-1)!.close, previous = candles.at(-(periods + 1))!.close; return previous > 0 ? (current / previous - 1) * 100 : null; }
function relativeVolumeAt(candles: TechnicalAnalysisResult['candles'], index: number) { const prior = candles.slice(Math.max(0, index - 20), index); const averageVolume = average(prior.map((candle) => candle.volume)); return averageVolume > 0 ? candles[index].volume / averageVolume : 0; }
function swingHighs(candles: TechnicalAnalysisResult['candles'], window: number) { const values: number[] = []; for (let index = window; index < candles.length - window; index += 1) { const range = candles.slice(index - window, index + window + 1); if (candles[index].high === Math.max(...range.map((candle) => candle.high))) values.push(candles[index].high); } return values.slice(-12); }
function recentValues(series: Array<{ value: number | null }>, count: number) { return series.filter((point) => point.value != null).slice(-count).map((point) => point.value!); }
function nearestBelow(values: Array<number | null | undefined>, ceiling: number) { return values.filter((value): value is number => value != null && value > 0 && value < ceiling).sort((a, b) => b - a)[0] ?? null; }
function tickSize(stock: TechnicalAnalysisResult) { const value = stock.instrument.tick_size; return value && value > 0 ? value / 100 : .05; }
function roundTick(value: number, tick: number) { return Math.round(Math.round(value / tick) * tick * 100) / 100; }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN; }
function round(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100; }
function fmt(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? 'N/A' : value.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function scoreComponent(id: string, label: string, value: number | null, weight: number, evidence: string): StrategyScoreComponent { return { id, label, value, weight, contribution: value == null ? null : value * weight / 100, evidence }; }
function sectorScore(value: SectorStrengthAnalysis['classification']) { return value === 'leading' ? 100 : value === 'improving' ? 80 : value === 'neutral' ? 55 : value === 'weakening' ? 30 : value === 'underperforming' ? 10 : null; }
function compareStrategies(a: StrategyEvaluation, b: StrategyEvaluation) { const priority: Record<TradeSetupStatus, number> = { ENTRY_AVAILABLE: 8, WAIT_FOR_CONFIRMATION: 7, WAIT_FOR_PULLBACK: 6, BREAKOUT_NOT_CONFIRMED: 5, PRICE_EXTENDED_DO_NOT_CHASE: 4, NO_VALID_SETUP: 3, SETUP_INVALIDATED: 2, INSUFFICIENT_MARKET_DATA: 1 }; return priority[b.status] - priority[a.status] || (b.score ?? 0) - (a.score ?? 0); }
function inputHash(stock: TechnicalAnalysisResult, config: StrategyConfiguration, context: unknown) { return createHash('sha256').update(JSON.stringify({ policyVersion: STRATEGY_POLICY_VERSION, instrument: stock.instrument.instrument_key, timeframe: stock.timeframe, candles: stock.candles, quote: stock.quote ?? null, validation: stock.validation, dataStatus: stock.dataStatus, config, context })).digest('hex').slice(0, 24); }
function compactBenchmark(value: TechnicalAnalysisResult): SystematicStrategyResult['benchmark'] { return { instrument: value.instrument, timeframe: value.timeframe, lastCandleAt: value.lastCandleAt, dataStatus: value.dataStatus }; }
