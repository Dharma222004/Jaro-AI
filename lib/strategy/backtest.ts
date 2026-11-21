import { calculateIndicators } from '@/lib/technical/indicators';
import type { MarketCandle, TechnicalTimeframe, UpstoxInstrument } from '@/types/technical';
import type { StrategyId } from '@/types/strategy';
import type { SystematicBacktestMetrics, SystematicBacktestResult, SystematicBacktestTrade, WalkForwardFold } from '@/types/systematic-backtest';
import { STRATEGY_CONFIGS, type StrategyConfiguration } from './config';

export function backtestSystematicStrategy(params: {
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  candles: MarketCandle[];
  benchmark: UpstoxInstrument;
  benchmarkCandles: MarketCandle[];
  strategyId: StrategyId;
}): SystematicBacktestResult {
  const config = STRATEGY_CONFIGS[params.strategyId];
  const marketRegimes = buildMarketRegimeLookup(params.benchmarkCandles, params.timeframe);
  const trades = simulate(params.candles, params.timeframe, config, marketRegimes);
  const trainEnd = Math.floor(params.candles.length * .6);
  const validationEnd = Math.floor(params.candles.length * .8);
  const training = trades.filter((trade) => candleIndex(params.candles, trade.signalAt) < trainEnd);
  const validation = trades.filter((trade) => { const index = candleIndex(params.candles, trade.signalAt); return index >= trainEnd && index < validationEnd; });
  const outOfSample = trades.filter((trade) => candleIndex(params.candles, trade.signalAt) >= validationEnd);
  const byYear = Object.fromEntries([...new Set(trades.map((trade) => trade.signalAt.slice(0, 4)))].map((year) => [year, metrics(trades.filter((trade) => trade.signalAt.startsWith(year)), params.candles.filter((candle) => candle.timestamp.startsWith(year)))]));
  const costSensitivity = [.5, 1, 1.5, 2].map((multiplier) => {
    const adjusted = trades.map((trade) => ({ ...trade, netReturnPct: trade.grossReturnPct - totalCostPct(config) * multiplier }));
    const result = metrics(adjusted, params.candles);
    return { costMultiplier: multiplier, expectancyPct: result.expectancyPct, profitFactor: result.profitFactor };
  });
  const parameterSensitivity = parameterVariants(config).map(({ label, config: variant }) => {
    const result = metrics(simulate(params.candles, params.timeframe, variant, marketRegimes), params.candles);
    return { variant: label, trades: result.trades, expectancyPct: result.expectancyPct, profitFactor: result.profitFactor };
  });
  return {
    strategyId: params.strategyId,
    strategyVersion: config.version,
    instrument: params.instrument,
    benchmark: params.benchmark,
    timeframe: params.timeframe,
    generatedAt: new Date().toISOString(),
    coverage: { from: params.candles[0]?.timestamp ?? null, to: params.candles.at(-1)?.timestamp ?? null, candles: params.candles.length },
    strategyParameters: {
      releaseStatus: config.releaseStatus,
      pivotWindow: config.pivotWindow,
      minimumDailyTradedValueCr: config.minimumDailyTradedValueCr,
      minimumNetRewardRisk: config.minimumNetRewardRisk,
      maximumEntryExtensionAtr: config.maximumEntryExtensionAtr,
      stopAtrMultiplier: config.stopAtrMultiplier,
      entryBufferAtr: config.entryBufferAtr,
      targetRiskMultiples: config.targetRiskMultiples,
      confirmationVolumeRatio: config.confirmationVolumeRatio,
    },
    assumptions: { signalAtCloseEntryAtNextOpen: true, buyCostBps: config.buyCostBps, sellCostBps: config.sellCostBps, slippageBpsPerSide: config.slippageBpsPerSide, maximumHoldingBars: config.maximumHoldingBars, sameBarStopBeforeTarget: true },
    training: metrics(training, params.candles.slice(0, trainEnd)),
    validation: metrics(validation, params.candles.slice(trainEnd, validationEnd)),
    outOfSample: metrics(outOfSample, params.candles.slice(validationEnd)),
    walkForward: buildWalkForward(trades, params.candles),
    overall: metrics(trades, params.candles),
    byRegime: { bull: metrics(trades.filter((trade) => trade.regime === 'bull'), params.candles), bear: metrics(trades.filter((trade) => trade.regime === 'bear'), params.candles), sideways: metrics(trades.filter((trade) => trade.regime === 'sideways'), params.candles) },
    byYear,
    costSensitivity,
    parameterSensitivity,
    trades,
    warnings: [
      'Simulated historical research—not actual performance or a forecast.',
      'Signals use only data available through each signal close; entries occur at the next bar open.',
      `Market-regime labels and the bearish-market gate use ${params.benchmark.name} candles available at each signal date.`,
      'If stop and target are touched in the same candle, the stop is assumed first.',
      'Forward sector-index, INDIA VIX, event-calendar, spread and market-impact gates are not modeled in this single-instrument simulator.',
      'Weekly-trend agreement is not reconstructed in this daily-only endpoint.',
      'The test uses one current instrument history and therefore does not eliminate survivorship bias.',
      'Corporate-action adjustment status is provider-dependent and was not independently reconstructed.',
      trades.length < 30 ? `Only ${trades.length} trades were observed; statistical conclusions are limited.` : '',
    ].filter(Boolean),
  };
}

function simulate(candles: MarketCandle[], timeframe: TechnicalTimeframe, config: StrategyConfiguration, marketRegimes: Map<string, SystematicBacktestTrade['regime']>): SystematicBacktestTrade[] {
  if (candles.length < 230) return [];
  const calculated = calculateIndicators(candles, timeframe);
  const raw = calculated.raw;
  const trades: SystematicBacktestTrade[] = [];
  let nextEligibleIndex = 220;
  for (let index = 220; index < candles.length - 2; index += 1) {
    if (index < nextEligibleIndex) continue;
    const marketRegime = marketRegimes.get(dateKey(candles[index].timestamp)) ?? 'sideways';
    if (marketRegime === 'bear') continue;
    const setup = config.id === 'trend_pullback_continuation'
      ? pullbackSignal(candles, raw, index, config)
      : breakoutSignal(candles, raw, index, config);
    if (!setup) continue;
    const entryIndex = index + 1;
    const referenceEntry = candles[entryIndex].open;
    const entry = referenceEntry * (1 + config.slippageBpsPerSide / 10_000);
    if (entry > setup.maximumEntry) continue;
    const stop = setup.stop;
    if (!(stop > 0 && stop < entry)) continue;
    const risk = entry - stop;
    const structuralTarget = setup.structuralTargets.filter((price) => price > entry).sort((a, b) => a - b)[0];
    const target = structuralTarget ?? entry + risk * config.targetRiskMultiples[0];
    const estimatedRoundTripCost = entry * totalCostPct(config) / 100;
    const estimatedNetRewardRisk = (target - entry - estimatedRoundTripCost) / (risk + estimatedRoundTripCost);
    if (estimatedNetRewardRisk < config.minimumNetRewardRisk) continue;
    let exitIndex = Math.min(candles.length - 1, entryIndex + config.maximumHoldingBars - 1);
    let referenceExit = candles[exitIndex].close;
    let exit = referenceExit * (1 - config.slippageBpsPerSide / 10_000);
    let reason: SystematicBacktestTrade['exitReason'] = 'time';
    for (let cursor = entryIndex; cursor <= exitIndex; cursor += 1) {
      if (candles[cursor].low <= stop) { exitIndex = cursor; referenceExit = Math.min(stop, candles[cursor].open); exit = referenceExit * (1 - config.slippageBpsPerSide / 10_000); reason = 'stop'; break; }
      if (candles[cursor].high >= target) { exitIndex = cursor; referenceExit = target; exit = target * (1 - config.slippageBpsPerSide / 10_000); reason = 'target'; break; }
    }
    const grossReturnPct = (referenceExit / referenceEntry - 1) * 100;
    const buyCharges = entry * config.buyCostBps / 10_000;
    const sellCharges = exit * config.sellCostBps / 10_000;
    const netPnlPerShare = exit - entry - buyCharges - sellCharges;
    const netReturnPct = netPnlPerShare / entry * 100;
    const stopFill = stop * (1 - config.slippageBpsPerSide / 10_000);
    const plannedNetRisk = Math.max(.01, entry - stopFill + buyCharges + stopFill * config.sellCostBps / 10_000);
    const rMultiple = netPnlPerShare / plannedNetRisk;
    trades.push({ signalAt: candles[index].timestamp, enteredAt: candles[entryIndex].timestamp, exitedAt: candles[exitIndex].timestamp, entry: round(entry), stop: round(stop), target: round(target), exit: round(exit), exitReason: reason, grossReturnPct: round(grossReturnPct), netReturnPct: round(netReturnPct), rMultiple: round(rMultiple), holdingBars: exitIndex - entryIndex + 1, regime: marketRegime });
    nextEligibleIndex = exitIndex + 1;
  }
  return trades;
}

function pullbackSignal(candles: MarketCandle[], raw: Record<string, Array<number | null>>, index: number, config: StrategyConfiguration) {
  const candle = candles[index], previous = candles[index - 1];
  const sma200 = raw.sma200[index], sma50 = raw.sma50[index], oldSma50 = raw.sma50[index - 20], ema20 = raw.ema20[index], ema50 = raw.ema50[index], atr = raw.atr14[index], rsi = raw.rsi14[index], histogram = raw.macdHistogram[index], previousHistogram = raw.macdHistogram[index - 1];
  if ([sma200, sma50, oldSma50, ema20, ema50, atr, rsi, histogram, previousHistogram].some((value) => value == null)) return null;
  const trend = candle.close > sma200! && sma50! > oldSma50! * 1.002 && ema20! > ema50!;
  const anchor = Math.max(...[ema20!, ema50!].filter((value) => value <= candle.close));
  const normalPullback = Number.isFinite(anchor) && Math.abs(candle.close - anchor) <= atr! * 1.05;
  const closeLocation = (candle.close - candle.low) / Math.max(.01, candle.high - candle.low);
  const momentum = rsi! >= 40 && rsi! <= 75 && (histogram! >= 0 || histogram! >= previousHistogram!);
  const confirmation = candle.close > candle.open && closeLocation >= .62 && candle.close > previous.high && momentum && relativeVolume(candles, index) >= config.confirmationVolumeRatio;
  const liquid = averageTradedValueCr(candles, index) >= config.minimumDailyTradedValueCr;
  if (!trend || !normalPullback || !confirmation || !liquid) return null;
  const structure = Math.min(...candles.slice(index - 10, index + 1).map((item) => item.low));
  const maximumEntry = previous.high + atr! * config.maximumEntryExtensionAtr;
  if (candle.close > maximumEntry) return null;
  return { stop: structure - atr! * config.stopAtrMultiplier, maximumEntry, structuralTargets: historicalSwingHighs(candles, index, config.pivotWindow) };
}

function breakoutSignal(candles: MarketCandle[], raw: Record<string, Array<number | null>>, index: number, config: StrategyConfiguration) {
  const atr = raw.atr14[index];
  const sma200 = raw.sma200[index];
  if (atr == null || sma200 == null || index < 220 || candles[index].close <= sma200 || averageTradedValueCr(candles, index) < config.minimumDailyTradedValueCr) return null;
  for (let breakoutIndex = Math.max(70, index - 8); breakoutIndex <= index - 2; breakoutIndex += 1) {
    const resistance = Math.max(...candles.slice(breakoutIndex - 65, breakoutIndex - 10).map((item) => item.high));
    const breakout = candles[breakoutIndex];
    if (!(breakout.close > resistance && relativeVolume(candles, breakoutIndex) >= config.confirmationVolumeRatio)) continue;
    const retest = candles.slice(breakoutIndex + 1, index + 1).some((item) => item.low <= resistance + atr * .45 && item.close >= resistance - atr * .1);
    const current = candles[index], previous = candles[index - 1];
    const maximumEntry = resistance + atr * config.maximumEntryExtensionAtr;
    if (retest && current.close > current.open && current.close > previous.high && current.close <= maximumEntry) return { stop: resistance - atr * config.stopAtrMultiplier, maximumEntry, structuralTargets: historicalSwingHighs(candles, index, config.pivotWindow) };
  }
  return null;
}

function metrics(trades: SystematicBacktestTrade[], candles: MarketCandle[]): SystematicBacktestMetrics {
  if (!trades.length) return { trades: 0, winRatePct: null, averageWinPct: null, averageLossPct: null, expectancyPct: null, averageR: null, profitFactor: null, maximumDrawdownPct: null, drawdownDurationTrades: 0, annualizedReturnPct: null, volatilityPct: null, sharpe: null, sortino: null, turnover: null, exposurePct: null, maximumConsecutiveLosses: 0 };
  const returns = trades.map((trade) => trade.netReturnPct);
  const wins = returns.filter((value) => value > 0), losses = returns.filter((value) => value <= 0);
  let equity = 1, peak = 1, maxDrawdown = 0, currentDuration = 0, maxDuration = 0, consecutiveLosses = 0, maxConsecutiveLosses = 0;
  for (const value of returns) { equity *= 1 + value / 100; peak = Math.max(peak, equity); const drawdown = (peak - equity) / peak * 100; if (drawdown > 0) { currentDuration += 1; maxDuration = Math.max(maxDuration, currentDuration); } else currentDuration = 0; maxDrawdown = Math.max(maxDrawdown, drawdown); if (value <= 0) { consecutiveLosses += 1; maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses); } else consecutiveLosses = 0; }
  const mean = average(returns), standardDeviation = std(returns), downsideDeviation = std(losses);
  const years = Math.max((new Date(candles.at(-1)?.timestamp ?? 0).getTime() - new Date(candles[0]?.timestamp ?? 0).getTime()) / (365.25 * 86_400_000), .25);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0), grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const totalHolding = trades.reduce((sum, trade) => sum + trade.holdingBars, 0);
  return { trades: trades.length, winRatePct: round(wins.length / trades.length * 100), averageWinPct: wins.length ? round(average(wins)) : null, averageLossPct: losses.length ? round(average(losses)) : null, expectancyPct: round(mean), averageR: round(average(trades.map((trade) => trade.rMultiple))), profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null, maximumDrawdownPct: round(maxDrawdown), drawdownDurationTrades: maxDuration, annualizedReturnPct: round((equity ** (1 / years) - 1) * 100), volatilityPct: round(standardDeviation), sharpe: standardDeviation > 0 ? round(mean / standardDeviation * Math.sqrt(Math.max(1, trades.length / years))) : null, sortino: downsideDeviation > 0 ? round(mean / downsideDeviation * Math.sqrt(Math.max(1, trades.length / years))) : null, turnover: trades.length * 2, exposurePct: round(totalHolding / Math.max(1, candles.length) * 100), maximumConsecutiveLosses: maxConsecutiveLosses };
}

function buildMarketRegimeLookup(candles: MarketCandle[], timeframe: TechnicalTimeframe) {
  const lookup = new Map<string, SystematicBacktestTrade['regime']>();
  if (candles.length < 220) return lookup;
  const raw = calculateIndicators(candles, timeframe).raw;
  for (let index = 200; index < candles.length; index += 1) {
    const close = candles[index].close;
    const sma50 = raw.sma50[index];
    const sma200 = raw.sma200[index];
    const oldSma50 = raw.sma50[index - 20];
    if (sma50 == null || sma200 == null || oldSma50 == null) continue;
    const directionPct = (sma50 / oldSma50 - 1) * 100;
    const regime: SystematicBacktestTrade['regime'] = close > sma50 && close > sma200 && directionPct >= -.5
      ? 'bull'
      : close < sma50 && close < sma200 && directionPct < -.5
        ? 'bear'
        : 'sideways';
    lookup.set(dateKey(candles[index].timestamp), regime);
  }
  return lookup;
}

function buildWalkForward(trades: SystematicBacktestTrade[], candles: MarketCandle[]): WalkForwardFold[] {
  if (candles.length < 250) return [];
  const initialTrainingEnd = Math.floor(candles.length * .6);
  const foldSize = Math.max(1, Math.floor((candles.length - initialTrainingEnd) / 4));
  const folds: WalkForwardFold[] = [];
  for (let fold = 0; fold < 4; fold += 1) {
    const testStart = initialTrainingEnd + fold * foldSize;
    const testEnd = fold === 3 ? candles.length : Math.min(candles.length, testStart + foldSize);
    if (testStart >= testEnd) continue;
    const testCandles = candles.slice(testStart, testEnd);
    const testTrades = trades.filter((trade) => {
      const index = candleIndex(candles, trade.signalAt);
      return index >= testStart && index < testEnd;
    });
    folds.push({
      fold: fold + 1,
      trainingWindow: { from: candles[0].timestamp, to: candles[testStart - 1].timestamp, candles: testStart },
      testWindow: { from: testCandles[0].timestamp, to: testCandles.at(-1)!.timestamp, candles: testCandles.length },
      metrics: metrics(testTrades, testCandles),
    });
  }
  return folds;
}

function parameterVariants(config: StrategyConfiguration) { return [{ label: 'stop buffer -20%', config: { ...config, stopAtrMultiplier: config.stopAtrMultiplier * .8 } }, { label: 'stop buffer +20%', config: { ...config, stopAtrMultiplier: config.stopAtrMultiplier * 1.2 } }, { label: 'volume threshold -0.15x', config: { ...config, confirmationVolumeRatio: Math.max(.5, config.confirmationVolumeRatio - .15) } }, { label: 'volume threshold +0.15x', config: { ...config, confirmationVolumeRatio: config.confirmationVolumeRatio + .15 } }]; }
function relativeVolume(candles: MarketCandle[], index: number) { const prior = candles.slice(index - 20, index); const value = average(prior.map((item) => item.volume)); return value > 0 ? candles[index].volume / value : 0; }
function historicalSwingHighs(candles: MarketCandle[], endIndex: number, window: number) { const values: number[] = []; const start = Math.max(window, endIndex - 250); for (let index = start; index <= endIndex - window; index += 1) { const range = candles.slice(index - window, index + window + 1); if (candles[index].high === Math.max(...range.map((candle) => candle.high))) values.push(candles[index].high); } return [...new Set(values)].sort((a, b) => a - b); }
function averageTradedValueCr(candles: MarketCandle[], index: number) { return average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close * item.volume)) / 10_000_000; }
function totalCostPct(config: StrategyConfiguration) { return (config.buyCostBps + config.sellCostBps + config.slippageBpsPerSide * 2) / 100; }
function candleIndex(candles: MarketCandle[], timestamp: string) { return candles.findIndex((candle) => candle.timestamp === timestamp); }
function dateKey(timestamp: string) { return timestamp.slice(0, 10); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values: number[]) { if (values.length < 2) return 0; const mean = average(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)); }
function round(value: number) { return Math.round(value * 100) / 100; }
