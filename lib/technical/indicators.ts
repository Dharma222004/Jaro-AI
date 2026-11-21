import type {
  IndicatorPoint,
  MarketCandle,
  TechnicalIndicatorSnapshot,
  TechnicalSeries,
  TechnicalTimeframe,
} from '@/types/technical';

type NumericSeries = Array<number | null>;

export interface CalculatedIndicators {
  snapshot: TechnicalIndicatorSnapshot;
  series: TechnicalSeries;
  raw: Record<string, NumericSeries>;
  pivotHighIndexes: number[];
  pivotLowIndexes: number[];
}

export function calculateIndicators(candles: MarketCandle[], timeframe: TechnicalTimeframe): CalculatedIndicators {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const volume = candles.map((c) => c.volume);

  const ema9 = ema(close, 9);
  const ema20 = ema(close, 20);
  const ema50 = ema(close, 50);
  const ema100 = ema(close, 100);
  const ema200 = ema(close, 200);
  const sma20 = sma(close, 20);
  const sma50 = sma(close, 50);
  const sma100 = sma(close, 100);
  const sma200 = sma(close, 200);
  const rsi14 = rsi(close, 14);
  const macd = zip(ema(close, 12), ema(close, 26), (a, b) => a - b);
  const macdSignal = emaNullable(macd, 9);
  const macdHistogram = zip(macd, macdSignal, (a, b) => a - b);
  const stochasticK = stochastic(high, low, close, 14);
  const stochasticD = smaNullable(stochasticK, 3);
  const roc12 = roc(close, 12);
  const tr = trueRange(high, low, close);
  const atr14 = wilder(tr, 14);
  const atrPct = zip(atr14, close.map((value) => value), (a, b) => b === 0 ? 0 : (a / b) * 100);
  const bollingerMiddle = sma20;
  const std20 = rollingStd(close, 20);
  const bollingerUpper = zip(bollingerMiddle, std20, (a, b) => a + 2 * b);
  const bollingerLower = zip(bollingerMiddle, std20, (a, b) => a - 2 * b);
  const historicalVolatility20 = historicalVolatility(close, 20, periodsPerYear(timeframe));
  const vwapSeries = vwap(candles, timeframe);
  const obvSeries = obv(close, volume);
  const averageVolume20 = sma(volume, 20);
  const relativeVolume = zip(volume.map((value) => value), averageVolume20, (a, b) => b === 0 ? 0 : a / b);
  const averageVolume5 = sma(volume, 5);
  const volumeMomentum = zip(averageVolume5, averageVolume20, (a, b) => b === 0 ? 0 : ((a / b) - 1) * 100);
  const directional = adx(high, low, close, 14);
  const pivotHighIndexes = pivots(high, 'high', 2);
  const pivotLowIndexes = pivots(low, 'low', 2);
  const structure = marketStructure(high, low, pivotHighIndexes, pivotLowIndexes);
  const levels = supportResistance(close.at(-1) ?? null, high, low, pivotHighIndexes, pivotLowIndexes);

  const raw: Record<string, NumericSeries> = {
    ema9, ema20, ema50, ema100, ema200, sma20, sma50, sma100, sma200, rsi14,
    macd, macdSignal, macdHistogram, stochasticK, stochasticD, roc12, atr14, atrPct,
    bollingerUpper, bollingerMiddle, bollingerLower, historicalVolatility20,
    vwap: vwapSeries, obv: obvSeries, relativeVolume, averageVolume20, volumeMomentum,
    adx14: directional.adx, plusDI14: directional.plusDI, minusDI14: directional.minusDI,
  };

  const snapshot: TechnicalIndicatorSnapshot = {
    ema9: last(ema9), ema20: last(ema20), ema50: last(ema50), ema100: last(ema100), ema200: last(ema200),
    sma20: last(sma20), sma50: last(sma50), sma100: last(sma100), sma200: last(sma200),
    rsi14: last(rsi14), macd: last(macd), macdSignal: last(macdSignal), macdHistogram: last(macdHistogram),
    stochasticK: last(stochasticK), stochasticD: last(stochasticD), roc12: last(roc12),
    atr14: last(atr14), atrPct: last(atrPct), bollingerUpper: last(bollingerUpper),
    bollingerMiddle: last(bollingerMiddle), bollingerLower: last(bollingerLower),
    historicalVolatility20: last(historicalVolatility20), vwap: last(vwapSeries), obv: last(obvSeries),
    relativeVolume: last(relativeVolume), averageVolume20: last(averageVolume20), volumeMomentum: last(volumeMomentum),
    adx14: last(directional.adx), plusDI14: last(directional.plusDI), minusDI14: last(directional.minusDI),
    support: levels.support, resistance: levels.resistance,
    swingHigh: pivotHighIndexes.length ? high[pivotHighIndexes.at(-1)!] : null,
    swingLow: pivotLowIndexes.length ? low[pivotLowIndexes.at(-1)!] : null,
    structure,
  };

  const pointSeries = (values: NumericSeries): IndicatorPoint[] => values.map((value, index) => ({
    timestamp: candles[index]?.timestamp ?? '', value: round(value),
  }));
  const series: TechnicalSeries = {
    ema20: pointSeries(ema20), ema50: pointSeries(ema50), ema200: pointSeries(ema200),
    sma20: pointSeries(sma20), sma50: pointSeries(sma50), sma200: pointSeries(sma200),
    bollingerUpper: pointSeries(bollingerUpper), bollingerMiddle: pointSeries(bollingerMiddle), bollingerLower: pointSeries(bollingerLower),
    rsi14: pointSeries(rsi14), macd: pointSeries(macd), macdSignal: pointSeries(macdSignal),
    macdHistogram: pointSeries(macdHistogram), volumeAverage20: pointSeries(averageVolume20),
  };

  return { snapshot: roundSnapshot(snapshot), series, raw, pivotHighIndexes, pivotLowIndexes };
}

function sma(values: number[], period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) output[i] = sum / period;
  }
  return output;
}

function smaNullable(values: NumericSeries, period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    const slice = values.slice(i - period + 1, i + 1);
    if (slice.every((value) => value != null)) output[i] = (slice as number[]).reduce((sum, value) => sum + value, 0) / period;
  }
  return output;
}

function ema(values: number[], period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  if (values.length < period) return output;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = seed;
  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) output[i] = (values[i] - output[i - 1]!) * multiplier + output[i - 1]!;
  return output;
}

function emaNullable(values: NumericSeries, period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  const first = values.findIndex((value) => value != null);
  if (first < 0) return output;
  const compact = values.slice(first).filter((value): value is number => value != null);
  const calculated = ema(compact, period);
  calculated.forEach((value, index) => { output[first + index] = value; });
  return output;
}

function rsi(values: number[], period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[i] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return output;
}

function stochastic(high: number[], low: number[], close: number[], period: number): NumericSeries {
  const output: NumericSeries = Array(close.length).fill(null);
  for (let i = period - 1; i < close.length; i += 1) {
    const highest = Math.max(...high.slice(i - period + 1, i + 1));
    const lowest = Math.min(...low.slice(i - period + 1, i + 1));
    output[i] = highest === lowest ? 50 : ((close[i] - lowest) / (highest - lowest)) * 100;
  }
  return output;
}

function roc(values: number[], period: number): NumericSeries {
  return values.map((value, index) => index < period || values[index - period] === 0 ? null : ((value / values[index - period]) - 1) * 100);
}

function trueRange(high: number[], low: number[], close: number[]): number[] {
  return high.map((value, index) => index === 0
    ? value - low[index]
    : Math.max(value - low[index], Math.abs(value - close[index - 1]), Math.abs(low[index] - close[index - 1])));
}

function wilder(values: number[], period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  if (values.length < period) return output;
  output[period - 1] = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i += 1) output[i] = (output[i - 1]! * (period - 1) + values[i]) / period;
  return output;
}

function rollingStd(values: number[], period: number): NumericSeries {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    const mean = slice.reduce((sum, value) => sum + value, 0) / period;
    return Math.sqrt(slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
  });
}

function historicalVolatility(values: number[], period: number, annualization: number): NumericSeries {
  const returns = values.map((value, index) => index === 0 ? null : Math.log(value / values[index - 1]));
  return returns.map((_, index) => {
    if (index < period) return null;
    const slice = returns.slice(index - period + 1, index + 1).filter((value): value is number => value != null);
    if (slice.length < period) return null;
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (slice.length - 1);
    return Math.sqrt(variance) * Math.sqrt(annualization) * 100;
  });
}

function vwap(candles: MarketCandle[], timeframe: TechnicalTimeframe): NumericSeries {
  if (!['1m', '5m', '15m', '30m', '1h'].includes(timeframe)) return Array(candles.length).fill(null);
  let date = '';
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const candleDate = candle.timestamp.slice(0, 10);
    if (candleDate !== date) {
      date = candleDate;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typical * candle.volume;
    cumulativeVolume += candle.volume;
    return cumulativeVolume === 0 ? null : cumulativePriceVolume / cumulativeVolume;
  });
}

function obv(close: number[], volume: number[]): NumericSeries {
  let value = 0;
  return close.map((price, index) => {
    if (index > 0) value += price > close[index - 1] ? volume[index] : price < close[index - 1] ? -volume[index] : 0;
    return value;
  });
}

function adx(high: number[], low: number[], close: number[], period: number) {
  const tr = trueRange(high, low, close);
  const plusDM = high.map((value, index) => {
    if (index === 0) return 0;
    const up = value - high[index - 1];
    const down = low[index - 1] - low[index];
    return up > down && up > 0 ? up : 0;
  });
  const minusDM = low.map((value, index) => {
    if (index === 0) return 0;
    const up = high[index] - high[index - 1];
    const down = low[index - 1] - value;
    return down > up && down > 0 ? down : 0;
  });
  const atr = wilder(tr, period);
  const smoothPlus = wilder(plusDM, period);
  const smoothMinus = wilder(minusDM, period);
  const plusDI = zip(smoothPlus, atr, (a, b) => b === 0 ? 0 : (a / b) * 100);
  const minusDI = zip(smoothMinus, atr, (a, b) => b === 0 ? 0 : (a / b) * 100);
  const dx = zip(plusDI, minusDI, (a, b) => a + b === 0 ? 0 : (Math.abs(a - b) / (a + b)) * 100);
  const adxSeries = wilderNullable(dx, period);
  return { adx: adxSeries, plusDI, minusDI };
}

function wilderNullable(values: NumericSeries, period: number): NumericSeries {
  const output: NumericSeries = Array(values.length).fill(null);
  const first = values.findIndex((value) => value != null);
  if (first < 0) return output;
  const compact = values.slice(first).filter((value): value is number => value != null);
  const calculated = wilder(compact, period);
  calculated.forEach((value, index) => { output[first + index] = value; });
  return output;
}

function pivots(values: number[], kind: 'high' | 'low', window: number) {
  const indexes: number[] = [];
  for (let i = window; i < values.length - window; i += 1) {
    const neighbors = values.slice(i - window, i + window + 1);
    const target = kind === 'high' ? Math.max(...neighbors) : Math.min(...neighbors);
    if (values[i] === target) indexes.push(i);
  }
  return indexes;
}

function marketStructure(high: number[], low: number[], highs: number[], lows: number[]): TechnicalIndicatorSnapshot['structure'] {
  if (highs.length < 2 || lows.length < 2) return 'insufficient-data';
  const [h1, h2] = highs.slice(-2).map((index) => high[index]);
  const [l1, l2] = lows.slice(-2).map((index) => low[index]);
  if (h2 > h1 && l2 > l1) return 'higher-highs-higher-lows';
  if (h2 < h1 && l2 < l1) return 'lower-highs-lower-lows';
  return 'mixed';
}

function supportResistance(current: number | null, high: number[], low: number[], highs: number[], lows: number[]) {
  if (current == null) return { support: null, resistance: null };
  const supportCandidates = lows.slice(-12).map((index) => low[index]).filter((value) => value < current).sort((a, b) => b - a);
  const resistanceCandidates = highs.slice(-12).map((index) => high[index]).filter((value) => value > current).sort((a, b) => a - b);
  return {
    support: supportCandidates[0] ?? (low.length ? Math.min(...low.slice(-20)) : null),
    resistance: resistanceCandidates[0] ?? (high.length ? Math.max(...high.slice(-20)) : null),
  };
}

function periodsPerYear(timeframe: TechnicalTimeframe) {
  const values: Record<TechnicalTimeframe, number> = {
    '1m': 252 * 375, '5m': 252 * 75, '15m': 252 * 25, '30m': 252 * 13, '1h': 252 * 7,
    '1d': 252, '1w': 52, '1mo': 12,
  };
  return values[timeframe];
}

function zip(a: NumericSeries, b: NumericSeries | number[], fn: (a: number, b: number) => number): NumericSeries {
  return a.map((value, index) => value == null || b[index] == null ? null : fn(value, b[index]!));
}

function last(values: NumericSeries): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] != null) return round(values[i]);
  return null;
}

function round(value: number | null, digits = 2): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits;
}

function roundSnapshot(snapshot: TechnicalIndicatorSnapshot): TechnicalIndicatorSnapshot {
  return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])) as unknown as TechnicalIndicatorSnapshot;
}
