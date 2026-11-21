export type TechnicalTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1mo';

export interface UpstoxInstrument {
  segment: string;
  name: string;
  exchange: string;
  isin?: string;
  instrument_type: string;
  instrument_key: string;
  exchange_token?: string;
  trading_symbol: string;
  short_name?: string;
  security_type?: string;
  tick_size?: number;
  lot_size?: number;
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number;
}

export interface CandleValidationSummary {
  received: number;
  accepted: number;
  duplicatesRemoved: number;
  rejectedInvalidTimestamp: number;
  rejectedInvalidPrice: number;
  rejectedInvalidOhlc: number;
  rejectedInvalidVolume: number;
  rejectedOutsideSession: number;
  estimatedMissingIntervals: number;
  timezoneOffsetsPresent: boolean;
  newestTimestamp: string | null;
}

export interface IndicatorPoint {
  timestamp: string;
  value: number | null;
}

export interface TechnicalIndicatorSnapshot {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  roc12: number | null;
  atr14: number | null;
  atrPct: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  historicalVolatility20: number | null;
  vwap: number | null;
  obv: number | null;
  relativeVolume: number | null;
  averageVolume20: number | null;
  volumeMomentum: number | null;
  adx14: number | null;
  plusDI14: number | null;
  minusDI14: number | null;
  support: number | null;
  resistance: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  structure: 'higher-highs-higher-lows' | 'lower-highs-lower-lows' | 'mixed' | 'insufficient-data';
}

export interface TechnicalSeries {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  ema200: IndicatorPoint[];
  sma20: IndicatorPoint[];
  sma50: IndicatorPoint[];
  sma200: IndicatorPoint[];
  bollingerUpper: IndicatorPoint[];
  bollingerMiddle: IndicatorPoint[];
  bollingerLower: IndicatorPoint[];
  rsi14: IndicatorPoint[];
  macd: IndicatorPoint[];
  macdSignal: IndicatorPoint[];
  macdHistogram: IndicatorPoint[];
  volumeAverage20: IndicatorPoint[];
}

export interface TechnicalSignal {
  name: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  timeframe: TechnicalTimeframe;
  detectedAt: string;
  evidence: string[];
  confirmation: 'confirmed' | 'developing' | 'unconfirmed';
  invalidation: string;
}

export interface TechnicalAnalysisResult {
  instrument: UpstoxInstrument;
  timeframe: TechnicalTimeframe;
  candles: MarketCandle[];
  indicators: TechnicalIndicatorSnapshot;
  series: TechnicalSeries;
  signals: TechnicalSignal[];
  trend: 'bullish' | 'bearish' | 'sideways' | 'insufficient-data';
  trendStrength: 'strong' | 'moderate' | 'weak' | 'unavailable';
  bullishFindings: string[];
  bearishFindings: string[];
  neutralFindings: string[];
  lastCandleAt: string | null;
  retrievedAt: string;
  dataStatus: 'live' | 'delayed' | 'latest-available' | 'historical' | 'cached' | 'stale-cache';
  provider: 'Upstox';
  marketSession: 'pre-open' | 'open' | 'closing-auction' | 'closed' | 'weekend';
  cache: { hit: boolean; expiresAt: string };
  warnings: string[];
  validation: CandleValidationSummary;
  quote?: {
    lastPrice: number;
    previousClose: number;
    yearHigh: number;
    yearLow: number;
    volume: number;
    timestamp: string;
    cached: boolean;
  };
}
