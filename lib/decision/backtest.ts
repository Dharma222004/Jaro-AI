import type { BacktestMetrics, BacktestResult, BacktestTrade } from '@/types/backtest';
import type { MarketCandle, TechnicalTimeframe, UpstoxInstrument } from '@/types/technical';
import { calculateIndicators } from '@/lib/technical/indicators';

export function backtestTechnicalMethodology(params: {
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  candles: MarketCandle[];
  initialCapital?: number;
  costBpsPerSide?: number;
  slippageBpsPerSide?: number;
}): BacktestResult {
  const { candles, timeframe } = params;
  const initialCapital = params.initialCapital ?? 100_000;
  const costBps = params.costBpsPerSide ?? 10;
  const slippageBps = params.slippageBpsPerSide ?? 5;
  const maximumHoldingBars = timeframe === '1d' ? 60 : timeframe === '1w' ? 20 : 80;
  const calculated = calculateIndicators(candles, timeframe);
  const raw = calculated.raw;
  const trades: BacktestTrade[] = [];
  let index = 200;

  while (index < candles.length - 2) {
    const close = candles[index].close;
    const signal = allAvailable(raw, ['ema20', 'ema50', 'ema200', 'rsi14', 'macdHistogram', 'adx14'], index)
      && close > raw.ema20[index]!
      && raw.ema20[index]! > raw.ema50[index]!
      && raw.ema50[index]! > raw.ema200[index]!
      && raw.rsi14[index]! >= 45 && raw.rsi14[index]! <= 68
      && raw.macdHistogram[index]! > 0
      && raw.adx14[index]! >= 18;
    if (!signal) { index += 1; continue; }

    // Signal uses only candle[index] and earlier. Execution occurs at next candle's open.
    const executionIndex = index + 1;
    const entryPrice = candles[executionIndex].open * (1 + slippageBps / 10_000);
    const atr = raw.atr14[index];
    if (atr == null || atr <= 0) { index += 1; continue; }
    const priorSupport = Math.min(...candles.slice(Math.max(0, index - 19), index + 1).map((candle) => candle.low));
    const stopPrice = Math.min(priorSupport - atr * 0.5, entryPrice - atr);
    const risk = entryPrice - stopPrice;
    if (risk <= 0) { index += 1; continue; }
    const targetPrice = entryPrice + risk * 2;
    const end = Math.min(candles.length - 1, executionIndex + maximumHoldingBars);
    let exitIndex = end;
    let rawExit = candles[end].close;
    let result: BacktestTrade['result'] = 'time-exit';
    for (let cursor = executionIndex; cursor <= end; cursor += 1) {
      // Conservative same-bar rule: if target and stop are both touched, count the stop first.
      if (candles[cursor].low <= stopPrice) { exitIndex = cursor; rawExit = stopPrice; result = 'stop'; break; }
      if (candles[cursor].high >= targetPrice) { exitIndex = cursor; rawExit = targetPrice; result = 'target'; break; }
    }
    const exitPrice = rawExit * (1 - slippageBps / 10_000);
    const grossReturn = (exitPrice - entryPrice) / entryPrice;
    const netReturn = grossReturn - (costBps * 2) / 10_000;
    trades.push({
      entryAt: candles[executionIndex].timestamp, exitAt: candles[exitIndex].timestamp,
      entryPrice: round(entryPrice), exitPrice: round(exitPrice), stopPrice: round(stopPrice), targetPrice: round(targetPrice),
      returnPct: round(netReturn * 100), result,
      regime: regimeAt(candles, raw.ema200, index),
    });
    index = exitIndex + 1;
  }

  const splitTime = candles[Math.floor(candles.length * 0.6)]?.timestamp;
  const inSampleTrades = trades.filter((trade) => !splitTime || trade.entryAt < splitTime);
  const outOfSampleTrades = trades.filter((trade) => splitTime && trade.entryAt >= splitTime);
  return {
    instrument: params.instrument,
    timeframe,
    methodology: [
      'Long-only signal: close > EMA20 > EMA50 > EMA200, RSI 45–68, positive MACD histogram and ADX ≥ 18.',
      'Signal is calculated at candle close; execution uses the next candle open to avoid look-ahead bias.',
      'Stop uses prior 20-period low minus 0.5 ATR, capped at a minimum one-ATR risk; target is 2R.',
      'If target and stop occur in one candle, the stop is assumed first (conservative ordering).',
      'Chronological 60/40 split is reported as in-sample/out-of-sample; no parameter optimisation is performed.',
    ],
    assumptions: { initialCapital, brokerageAndChargesBpsPerSide: costBps, slippageBpsPerSide: slippageBps, maximumHoldingBars },
    coverage: { from: candles[0]?.timestamp ?? '', to: candles.at(-1)?.timestamp ?? '', candles: candles.length },
    inSample: metrics(inSampleTrades, initialCapital),
    outOfSample: metrics(outOfSampleTrades, initialCapital),
    overall: metrics(trades, initialCapital),
    regimePerformance: {
      bull: metrics(trades.filter((trade) => trade.regime === 'bull'), initialCapital),
      bear: metrics(trades.filter((trade) => trade.regime === 'bear'), initialCapital),
      sideways: metrics(trades.filter((trade) => trade.regime === 'sideways'), initialCapital),
    },
    trades,
    warnings: [
      'A single-instrument backtest does not eliminate survivorship bias; delisted and historically eligible universe members are not represented.',
      'Daily OHLC cannot reveal intrabar path, so same-candle stop/target ordering is conservatively assumed.',
      'Corporate-action adjustment depends on provider candle methodology and is not independently reconstructed.',
      'Historical performance does not establish future profitability or a calibrated probability.',
    ],
    generatedAt: new Date().toISOString(),
  };
}

function metrics(trades: BacktestTrade[], initialCapital: number): BacktestMetrics {
  if (!trades.length) return { trades: 0, wins: 0, losses: 0, winRatePct: null, averageReturnPct: null, averageWinPct: null, averageLossPct: null, maximumDrawdownPct: null, profitFactor: null, averageRealizedRiskReward: null };
  const wins = trades.filter((trade) => trade.returnPct > 0);
  const losses = trades.filter((trade) => trade.returnPct <= 0);
  const returns = trades.map((trade) => trade.returnPct);
  let equity = initialCapital;
  let peak = equity;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity *= 1 + trade.returnPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, (equity - peak) / peak * 100);
  }
  const grossProfit = wins.reduce((sum, trade) => sum + trade.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.returnPct, 0));
  const realizedRR = trades.map((trade) => {
    const risk = trade.entryPrice - trade.stopPrice;
    return risk > 0 ? (trade.exitPrice - trade.entryPrice) / risk : 0;
  });
  return {
    trades: trades.length, wins: wins.length, losses: losses.length,
    winRatePct: round(wins.length / trades.length * 100), averageReturnPct: average(returns),
    averageWinPct: wins.length ? average(wins.map((trade) => trade.returnPct)) : null,
    averageLossPct: losses.length ? average(losses.map((trade) => trade.returnPct)) : null,
    maximumDrawdownPct: round(maxDrawdown), profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    averageRealizedRiskReward: average(realizedRR),
  };
}

function allAvailable(raw: Record<string, Array<number | null>>, keys: string[], index: number) { return keys.every((key) => raw[key]?.[index] != null); }
function regimeAt(candles: MarketCandle[], ema200: Array<number | null>, index: number): BacktestTrade['regime'] {
  const ema = ema200[index]; const prior = ema200[Math.max(0, index - 20)];
  if (ema == null || prior == null) return 'sideways';
  if (candles[index].close > ema && ema > prior) return 'bull';
  if (candles[index].close < ema && ema < prior) return 'bear';
  return 'sideways';
}
function average(values: number[]) { return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }
function round(value: number) { return Math.round(value * 100) / 100; }
