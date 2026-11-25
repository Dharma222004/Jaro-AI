import type { CandleValidationSummary, MarketCandle, TechnicalAnalysisResult, TechnicalSignal, TechnicalTimeframe, UpstoxInstrument } from '@/types/technical';
import type { CalculatedIndicators } from './indicators';

export function interpretTechnicals(params: {
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  candles: MarketCandle[];
  calculated: CalculatedIndicators;
  retrievedAt: string;
  cacheHit: boolean;
  expiresAt: string;
  validation: CandleValidationSummary;
  staleCache: boolean;
  isDelayedFeed?: boolean;
}): Omit<TechnicalAnalysisResult, 'series' | 'indicators'> {
  const { candles, calculated, timeframe } = params;
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const i = calculated.snapshot;
  const signals: TechnicalSignal[] = [];
  const bullish: string[] = [];
  const bearish: string[] = [];
  const neutral: string[] = [];
  const detectedAt = latest?.timestamp ?? params.retrievedAt;
  const addSignal = (signal: Omit<TechnicalSignal, 'timeframe' | 'detectedAt'>) => signals.push({ ...signal, timeframe, detectedAt });

  const bullishAlignment = latest && i.ema20 != null && i.ema50 != null && i.ema200 != null
    && latest.close > i.ema20 && i.ema20 > i.ema50 && i.ema50 > i.ema200;
  const bearishAlignment = latest && i.ema20 != null && i.ema50 != null && i.ema200 != null
    && latest.close < i.ema20 && i.ema20 < i.ema50 && i.ema50 < i.ema200;
  const trend = candles.length < 50 ? 'insufficient-data'
    : bullishAlignment || i.structure === 'higher-highs-higher-lows' ? 'bullish'
    : bearishAlignment || i.structure === 'lower-highs-lower-lows' ? 'bearish'
    : 'sideways';
  const trendStrength = i.adx14 == null ? 'unavailable' : i.adx14 >= 25 ? 'strong' : i.adx14 >= 18 ? 'moderate' : 'weak';

  if (bullishAlignment) bullish.push(`Price and EMA structure are positively aligned: close > EMA20 > EMA50 > EMA200.`);
  if (bearishAlignment) bearish.push(`Price and EMA structure are negatively aligned: close < EMA20 < EMA50 < EMA200.`);
  if (i.structure === 'higher-highs-higher-lows') bullish.push('Recent swing structure shows higher highs and higher lows.');
  if (i.structure === 'lower-highs-lower-lows') bearish.push('Recent swing structure shows lower highs and lower lows.');

  const ema50 = calculated.raw.ema50;
  const ema200 = calculated.raw.ema200;
  const cross = recentCross(ema50, ema200, 5);
  if (cross === 'up') addSignal({ name: 'Golden Cross', direction: 'bullish', evidence: [`EMA50 crossed above EMA200; latest ${fmt(i.ema50)} vs ${fmt(i.ema200)}.`], confirmation: latest && i.adx14 != null && i.adx14 >= 20 ? 'confirmed' : 'developing', invalidation: 'EMA50 closes back below EMA200.' });
  if (cross === 'down') addSignal({ name: 'Death Cross', direction: 'bearish', evidence: [`EMA50 crossed below EMA200; latest ${fmt(i.ema50)} vs ${fmt(i.ema200)}.`], confirmation: latest && i.adx14 != null && i.adx14 >= 20 ? 'confirmed' : 'developing', invalidation: 'EMA50 closes back above EMA200.' });

  if (i.rsi14 != null && i.rsi14 >= 70) {
    bearish.push(`RSI(14) is overbought at ${fmt(i.rsi14)}; this is a condition, not a standalone reversal signal.`);
    addSignal({ name: 'RSI overbought condition', direction: 'neutral', evidence: [`RSI(14) = ${fmt(i.rsi14)}.`], confirmation: 'confirmed', invalidation: 'RSI falls below 70 or price consolidates without momentum loss.' });
  } else if (i.rsi14 != null && i.rsi14 <= 30) {
    bullish.push(`RSI(14) is oversold at ${fmt(i.rsi14)}; confirmation from price action is still required.`);
    addSignal({ name: 'RSI oversold condition', direction: 'neutral', evidence: [`RSI(14) = ${fmt(i.rsi14)}.`], confirmation: 'confirmed', invalidation: 'RSI remains below 30 while price continues making lower lows.' });
  }

  const macdCross = recentCross(calculated.raw.macd, calculated.raw.macdSignal, 3);
  if (macdCross === 'up') addSignal({ name: 'MACD bullish crossover', direction: 'bullish', evidence: [`MACD ${fmt(i.macd)} crossed above signal ${fmt(i.macdSignal)}.`], confirmation: i.macd != null && i.macd > 0 ? 'confirmed' : 'developing', invalidation: 'MACD crosses back below its signal line.' });
  if (macdCross === 'down') addSignal({ name: 'MACD bearish crossover', direction: 'bearish', evidence: [`MACD ${fmt(i.macd)} crossed below signal ${fmt(i.macdSignal)}.`], confirmation: i.macd != null && i.macd < 0 ? 'confirmed' : 'developing', invalidation: 'MACD crosses back above its signal line.' });

  const previousResistance = previousLevel(candles, 'high', 20);
  const previousSupport = previousLevel(candles, 'low', 20);
  if (latest && previous && previousResistance != null && latest.close > previousResistance && previous.close <= previousResistance) {
    const confirmed = (i.relativeVolume ?? 0) >= 1.5;
    addSignal({
      name: confirmed ? 'Volume-confirmed resistance breakout' : 'Potential false breakout',
      direction: 'bullish',
      evidence: [`Close ${fmt(latest.close)} exceeded prior 20-period resistance ${fmt(previousResistance)}.`, `Relative volume = ${fmt(i.relativeVolume)}x.`],
      confirmation: confirmed ? 'confirmed' : 'unconfirmed',
      invalidation: `A close back below ${fmt(previousResistance)} invalidates the breakout.`,
    });
    (confirmed ? bullish : neutral).push(`Price broke the prior 20-period resistance at ${fmt(previousResistance)} with ${confirmed ? 'supportive' : 'insufficient'} volume.`);
  }
  if (latest && previous && previousSupport != null && latest.close < previousSupport && previous.close >= previousSupport) {
    addSignal({ name: 'Support breakdown', direction: 'bearish', evidence: [`Close ${fmt(latest.close)} fell below prior support ${fmt(previousSupport)}.`, `Relative volume = ${fmt(i.relativeVolume)}x.`], confirmation: (i.relativeVolume ?? 0) >= 1.3 ? 'confirmed' : 'developing', invalidation: `A close back above ${fmt(previousSupport)} invalidates the breakdown.` });
    bearish.push(`Price closed below the prior 20-period support at ${fmt(previousSupport)}.`);
  }

  detectDivergence(candles, calculated, timeframe, detectedAt).forEach((signal) => signals.push(signal));

  const atrPctSeries = calculated.raw.atrPct;
  const currentAtrPct = i.atrPct;
  const oldAtrPct = valueAt(atrPctSeries, atrPctSeries.length - 11);
  if (currentAtrPct != null && oldAtrPct != null && oldAtrPct > 0) {
    const change = ((currentAtrPct / oldAtrPct) - 1) * 100;
    if (change > 25) addSignal({ name: 'Volatility expansion', direction: 'neutral', evidence: [`ATR% expanded ${fmt(change)}% over roughly 10 periods.`], confirmation: 'confirmed', invalidation: 'ATR% reverts below its prior 10-period level.' });
    if (change < -20) addSignal({ name: 'Volatility contraction', direction: 'neutral', evidence: [`ATR% contracted ${fmt(Math.abs(change))}% over roughly 10 periods.`], confirmation: 'confirmed', invalidation: 'ATR% expands above its prior 10-period level.' });
  }

  if (i.macdHistogram != null && i.roc12 != null) {
    if (trend === 'bullish' && (i.macdHistogram < 0 || i.roc12 < 0)) bearish.push('Momentum is deteriorating despite the broader bullish structure.');
    if (trend === 'bearish' && (i.macdHistogram > 0 || i.roc12 > 0)) bullish.push('Momentum is improving despite the broader bearish structure.');
  }
  if (!bullish.length) neutral.push('No multi-indicator bullish confirmation was detected.');
  if (!bearish.length) neutral.push('No multi-indicator bearish confirmation was detected.');

  return {
    instrument: params.instrument,
    timeframe,
    candles,
    signals,
    trend,
    trendStrength,
    bullishFindings: bullish,
    bearishFindings: bearish,
    neutralFindings: neutral,
    lastCandleAt: latest?.timestamp ?? null,
    retrievedAt: params.retrievedAt,
    dataStatus: params.staleCache
      ? 'stale-cache'
      : params.isDelayedFeed
        ? 'delayed'
        : params.cacheHit
          ? 'cached'
          : isCurrentSessionCandle(latest?.timestamp)
            ? 'latest-available'
            : 'historical',
    provider: 'Upstox',
    marketSession: marketSession(),
    cache: { hit: params.cacheHit, expiresAt: params.expiresAt },
    validation: params.validation,
    warnings: [
      ...(candles.length < 200 ? [`Only ${candles.length} validated candles were available; 200-period indicators may be unavailable.`] : []),
      ...(params.validation.estimatedMissingIntervals > 0 ? [`Approximately ${params.validation.estimatedMissingIntervals} intraday intervals were missing inside trading sessions.`] : []),
      ...(params.staleCache ? ['The provider request failed and a previously validated cache entry was used. Check the displayed candle timestamp before relying on freshness.'] : []),
      ...(!params.validation.timezoneOffsetsPresent ? ['One or more source timestamps lacked an explicit timezone offset. Parsed timestamps were retained only when valid.'] : []),
      'Signals are deterministic research observations, not predictions or trading instructions.',
      'Exchange holiday status is not inferred solely from the clock; last-candle timestamp is shown separately.',
    ],
  };
}

function detectDivergence(candles: MarketCandle[], calculated: CalculatedIndicators, timeframe: TechnicalTimeframe, detectedAt: string): TechnicalSignal[] {
  const output: TechnicalSignal[] = [];
  const lows = calculated.pivotLowIndexes.slice(-2);
  if (lows.length === 2) {
    const [a, b] = lows;
    const rsiA = calculated.raw.rsi14[a];
    const rsiB = calculated.raw.rsi14[b];
    if (rsiA != null && rsiB != null && candles[b].low < candles[a].low && rsiB > rsiA) output.push({ name: 'Bullish RSI divergence', direction: 'bullish', timeframe, detectedAt, evidence: ['Price formed a lower pivot low while RSI formed a higher low.'], confirmation: 'developing', invalidation: `A decisive close below ${fmt(candles[b].low)} without momentum improvement.` });
  }
  const highs = calculated.pivotHighIndexes.slice(-2);
  if (highs.length === 2) {
    const [a, b] = highs;
    const rsiA = calculated.raw.rsi14[a];
    const rsiB = calculated.raw.rsi14[b];
    if (rsiA != null && rsiB != null && candles[b].high > candles[a].high && rsiB < rsiA) output.push({ name: 'Bearish RSI divergence', direction: 'bearish', timeframe, detectedAt, evidence: ['Price formed a higher pivot high while RSI formed a lower high.'], confirmation: 'developing', invalidation: `A decisive close above ${fmt(candles[b].high)} with renewed momentum.` });
  }
  return output;
}

function recentCross(a: Array<number | null>, b: Array<number | null>, lookback: number): 'up' | 'down' | null {
  for (let index = a.length - 1; index >= Math.max(1, a.length - lookback); index -= 1) {
    if (a[index] == null || b[index] == null || a[index - 1] == null || b[index - 1] == null) continue;
    if (a[index - 1]! <= b[index - 1]! && a[index]! > b[index]!) return 'up';
    if (a[index - 1]! >= b[index - 1]! && a[index]! < b[index]!) return 'down';
  }
  return null;
}

function previousLevel(candles: MarketCandle[], field: 'high' | 'low', periods: number) {
  const values = candles.slice(-(periods + 1), -1).map((candle) => candle[field]);
  if (!values.length) return null;
  return field === 'high' ? Math.max(...values) : Math.min(...values);
}

function valueAt(values: Array<number | null>, index: number) {
  return index >= 0 ? values[index] ?? null : null;
}

function marketSession(): TechnicalAnalysisResult['marketSession'] {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'weekend';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  if (minutes >= 540 && minutes < 555) return 'pre-open';
  if (minutes >= 555 && minutes < 930) return 'open';
  if (minutes >= 930 && minutes < 940) return 'closing-auction';
  return 'closed';
}

function isCurrentSessionCandle(timestamp?: string) {
  return timestamp?.slice(0, 10) === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function fmt(value: number | null) {
  return value == null ? 'N/A' : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
