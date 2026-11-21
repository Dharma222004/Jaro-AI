/**
 * Yahoo Finance client for Indian equity market data (NSE/BSE)
 *
 * Uses the `yahoo-finance2` library which queries Yahoo Finance's
 * undocumented internal endpoints. Data is free but may be 15-20 min
 * delayed. Use suffix `.NS` for NSE and `.BO` for BSE.
 *
 * NOTE: This is an unofficial API. Handle failures gracefully and
 * always fall back to Tavily/Screener data in the research pipeline.
 */

// yahoo-finance2 v3 uses a class-based API
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yahooFinanceModule = require('yahoo-finance2');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = yahooFinanceModule.default as any;

// Singleton instance with notice suppressed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _yf: any = null;
function getYF() {
  if (!_yf) {
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }
  return _yf;
}

/** Structured live market data for an NSE/BSE stock */
export interface LiveMarketData {
  // Identity
  symbol: string;           // e.g. RELIANCE.NS
  yahooSymbol: string;      // Yahoo's symbol
  longName: string;
  exchange: string;         // NSI (NSE), BSE
  currency: string;         // INR

  // Price
  price: number;
  priceChange: number;
  priceChangePct: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  open: number;

  // 52-week
  high52w: number;
  low52w: number;

  // Volume
  volume: number;
  avgVolume10d: number;

  // Market metrics (from quote)
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  eps: number | null;
  bookValue: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  beta: number | null;

  // From quoteSummary – fundamentals
  enterpriseValue?: number | null;
  ebitda?: number | null;
  totalRevenue?: number | null;
  totalCash?: number | null;
  totalDebt?: number | null;
  debtToEquity?: number | null;
  grossMargins?: number | null;
  operatingMargins?: number | null;
  ebitdaMargins?: number | null;
  profitMargins?: number | null;
  returnOnEquity?: number | null;
  returnOnAssets?: number | null;
  revenueGrowth?: number | null;
  earningsGrowth?: number | null;
  freeCashflow?: number | null;
  operatingCashflow?: number | null;
  currentRatio?: number | null;
  quickRatio?: number | null;
  targetMeanPrice?: number | null;
  recommendationKey?: string | null;
  numberOfAnalystOpinions?: number | null;

  // Ownership (from defaultKeyStatistics)
  heldPercentInsiders?: number | null;
  heldPercentInstitutions?: number | null;
  sharesOutstanding?: number | null;
  floatShares?: number | null;
  trailingEps?: number | null;
  forwardEps?: number | null;
  evEbitda?: number | null;
  evRevenue?: number | null;
  weekChange52?: number | null;

  // Calculated from daily historical prices (not LLM-generated)
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  rsi14?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  support20d?: number | null;
  resistance20d?: number | null;
  averageVolume20d?: number | null;
  volumeTrend?: 'Above average' | 'Below average' | 'In line' | null;
  priceMomentum20dPct?: number | null;

  // Sector/Industry (from assetProfile)
  sector?: string | null;
  industry?: string | null;
  fullTimeEmployees?: number | null;
  longBusinessSummary?: string | null;

  fetchedAt: string; // ISO timestamp
}

/**
 * Map a NSE ticker to Yahoo Finance symbol.
 * Appends .NS for NSE (default) and .BO for BSE.
 */
export function toYahooSymbol(ticker: string, exchange: 'NSE' | 'BSE' = 'NSE'): string {
  // Remove any existing suffix
  const clean = ticker.replace(/\.(NS|BO)$/i, '').toUpperCase();
  const suffix = exchange === 'BSE' ? '.BO' : '.NS';
  return `${clean}${suffix}`;
}

/**
 * Resolve the correct Yahoo Finance symbol for an Indian stock.
 * Strategy:
 *   1. Try direct symbol (TICKER.NS or TICKER.BO)
 *   2. If that returns no data, use yf.search(ticker) and pick the
 *      first NSE/BSE equity result
 *   3. If exchange-preferred not found, try the other exchange
 * Returns the resolved symbol string or null if nothing found.
 */
async function resolveYahooSymbol(
  ticker: string,
  exchange: 'NSE' | 'BSE',
): Promise<string | null> {
  const yf = getYF();
  const primarySuffix = exchange === 'BSE' ? '.BO' : '.NS';
  const alternateSuffix = exchange === 'BSE' ? '.NS' : '.BO';
  const clean = ticker.replace(/\.(NS|BO)$/i, '').toUpperCase();

  // 1. Try primary symbol first
  const primary = `${clean}${primarySuffix}`;
  try {
    const q = await yf.quote(primary);
    if (q && q.regularMarketPrice != null) return primary;
  } catch { /* try search fallback */ }

  // 2. Search by ticker text — Yahoo Finance search returns the correct symbol
  try {
    const searchResult = await yf.search(clean);
    const quotes = searchResult?.quotes ?? [];

    // Prefer NSE (NSI) or BSE equities
    const preferredExchange = exchange === 'BSE' ? 'BSE' : 'NSI';
    const fallbackExchange = exchange === 'BSE' ? 'NSI' : 'BSE';

    const findMatch = (exch: string) =>
      quotes.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q: any) => q.quoteType === 'EQUITY' && q.exchange === exch && q.symbol,
      )?.symbol ?? null;

    const found = findMatch(preferredExchange) ?? findMatch(fallbackExchange);
    if (found) {
      console.log(`[yahoo-finance] Resolved ${ticker} → ${found} via search`);
      return found;
    }
  } catch { /* fall through */ }

  // 3. Try alternate exchange suffix as last resort
  const alternate = `${clean}${alternateSuffix}`;
  try {
    const q = await yf.quote(alternate);
    if (q && q.regularMarketPrice != null) {
      console.log(`[yahoo-finance] Resolved ${ticker} → ${alternate} via alternate exchange`);
      return alternate;
    }
  } catch { /* nothing worked */ }

  console.warn(`[yahoo-finance] Could not resolve symbol for ticker: ${ticker}`);
  return null;
}

/**
 * Fetch comprehensive live market data for an Indian stock.
 * Attempts both quote and quoteSummary in parallel.
 * Returns null if the ticker is not found or any error occurs.
 */
export async function fetchLiveMarketData(
  ticker: string,
  exchange: 'NSE' | 'BSE' = 'NSE',
): Promise<LiveMarketData | null> {
  const yf = getYF();

  // Resolve the correct Yahoo Finance symbol (with search fallback for mismatched tickers)
  const symbol = await resolveYahooSymbol(ticker, exchange);
  if (!symbol) return null;

  try {
    // Fetch quote (fast) and quoteSummary (deep) in parallel
    const [quote, summary, chart] = await Promise.all([
      yf.quote(symbol).catch(() => null),
      yf.quoteSummary(symbol, {
        modules: ['financialData', 'defaultKeyStatistics', 'assetProfile'],
      }).catch(() => null),
      yf.chart(symbol, {
        period1: new Date(Date.now() - 420 * 24 * 60 * 60 * 1000),
        interval: '1d',
      }).catch(() => null),
    ]);

    if (!quote) return null;

    const fd = summary?.financialData ?? {};
    const dk = summary?.defaultKeyStatistics ?? {};
    const ap = summary?.assetProfile ?? {};
    const quotes = Array.isArray(chart?.quotes) ? chart.quotes : [];
    const closes = quotes.map((item: { close?: number | null }) => item.close).filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));
    const volumes = quotes.map((item: { volume?: number | null }) => item.volume).filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));
    const technical = calculateTechnicalIndicators(closes, volumes, quote.regularMarketVolume ?? 0);

    return {
      symbol,
      yahooSymbol: quote.symbol ?? symbol,
      longName: quote.longName ?? quote.shortName ?? ticker,
      exchange: quote.exchange ?? (exchange === 'NSE' ? 'NSI' : 'BSE'),
      currency: quote.currency ?? 'INR',

      price: quote.regularMarketPrice ?? 0,
      priceChange: quote.regularMarketChange ?? 0,
      priceChangePct: quote.regularMarketChangePercent ?? 0,
      dayHigh: quote.regularMarketDayHigh ?? 0,
      dayLow: quote.regularMarketDayLow ?? 0,
      previousClose: quote.regularMarketPreviousClose ?? 0,
      open: quote.regularMarketOpen ?? 0,

      high52w: quote.fiftyTwoWeekHigh ?? 0,
      low52w: quote.fiftyTwoWeekLow ?? 0,

      volume: quote.regularMarketVolume ?? 0,
      avgVolume10d: quote.averageDailyVolume10Day ?? 0,

      marketCap: quote.marketCap ?? null,
      trailingPE: quote.trailingPE ?? null,
      forwardPE: quote.forwardPE ?? null,
      eps: quote.epsTrailingTwelveMonths ?? null,
      bookValue: quote.bookValue ?? null,
      priceToBook: quote.priceToBook ?? null,
      dividendYield: quote.trailingAnnualDividendYield ?? null,
      beta: dk.beta ?? quote.beta ?? null,

      // Deep fundamentals
      enterpriseValue: dk.enterpriseValue ?? null,
      ebitda: fd.ebitda ?? null,
      totalRevenue: fd.totalRevenue ?? null,
      totalCash: fd.totalCash ?? null,
      totalDebt: fd.totalDebt ?? null,
      debtToEquity: fd.debtToEquity ?? null,
      grossMargins: fd.grossMargins ?? null,
      operatingMargins: fd.operatingMargins ?? null,
      ebitdaMargins: fd.ebitdaMargins ?? null,
      profitMargins: fd.profitMargins ?? null,
      returnOnEquity: fd.returnOnEquity ?? null,
      returnOnAssets: fd.returnOnAssets ?? null,
      revenueGrowth: fd.revenueGrowth ?? null,
      earningsGrowth: fd.earningsGrowth ?? null,
      freeCashflow: fd.freeCashflow ?? null,
      operatingCashflow: fd.operatingCashflow ?? null,
      currentRatio: fd.currentRatio ?? null,
      quickRatio: fd.quickRatio ?? null,
      targetMeanPrice: fd.targetMeanPrice ?? null,
      recommendationKey: fd.recommendationKey ?? null,
      numberOfAnalystOpinions: fd.numberOfAnalystOpinions ?? null,

      // Ownership
      heldPercentInsiders: dk.heldPercentInsiders ?? null,
      heldPercentInstitutions: dk.heldPercentInstitutions ?? null,
      sharesOutstanding: dk.sharesOutstanding ?? null,
      floatShares: dk.floatShares ?? null,
      trailingEps: dk.trailingEps ?? null,
      forwardEps: dk.forwardEps ?? null,
      evEbitda: dk.enterpriseToEbitda ?? null,
      evRevenue: dk.enterpriseToRevenue ?? null,
      weekChange52: dk['52WeekChange'] ?? null,

      sma20: technical.sma20,
      sma50: technical.sma50,
      sma200: technical.sma200,
      rsi14: technical.rsi14,
      macd: technical.macd,
      macdSignal: technical.macdSignal,
      support20d: technical.support20d,
      resistance20d: technical.resistance20d,
      averageVolume20d: technical.averageVolume20d,
      volumeTrend: technical.volumeTrend,
      priceMomentum20dPct: technical.priceMomentum20dPct,

      // Company profile
      sector: ap.sector ?? null,
      industry: ap.industry ?? null,
      fullTimeEmployees: ap.fullTimeEmployees ?? null,
      longBusinessSummary: ap.longBusinessSummary ?? null,

      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[yahoo-finance] Failed to fetch data for', symbol, ':', err instanceof Error ? err.message : err);
    return null;
  }
}

function calculateTechnicalIndicators(closes: number[], volumes: number[], currentVolume: number) {
  const average = (values: number[], period: number): number | null => {
    if (period <= 0 || values.length < period) return null;
    const slice = values.slice(-period);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  };
  const emaSeries = (values: number[], period: number): number[] => {
    if (values.length < period) return [];
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const output = [ema];
    for (const value of values.slice(period)) {
      ema = (value - ema) * multiplier + ema;
      output.push(ema);
    }
    return output;
  };
  const round = (value: number | null, decimals = 2) => value == null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals;

  let rsi14: number | null = null;
  if (closes.length >= 15) {
    const recent = closes.slice(-15);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < recent.length; i += 1) {
      const change = recent[i] - recent[i - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }
    const averageGain = gains / 14;
    const averageLoss = losses / 14;
    rsi14 = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  }

  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const alignment = Math.min(ema12.length, ema26.length);
  const aligned12 = ema12.slice(-alignment);
  const aligned26 = ema26.slice(-alignment);
  const macdSeries = alignment > 0 ? aligned12.map((value, index) => value - aligned26[index]) : [];
  const signalSeries = emaSeries(macdSeries, 9);
  const recentCloses = closes.slice(-20);
  const averageVolume20d = average(volumes, Math.min(20, volumes.length));
  const momentum = closes.length >= 20 && closes[closes.length - 20] !== 0
    ? ((closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20]) * 100
    : null;
  let volumeTrend: 'Above average' | 'Below average' | 'In line' | null = null;
  if (averageVolume20d && currentVolume) {
    const ratio = currentVolume / averageVolume20d;
    volumeTrend = ratio > 1.2 ? 'Above average' : ratio < 0.8 ? 'Below average' : 'In line';
  }

  return {
    sma20: round(average(closes, 20)),
    sma50: round(average(closes, 50)),
    sma200: round(average(closes, 200)),
    rsi14: round(rsi14, 1),
    macd: round(macdSeries.length ? macdSeries[macdSeries.length - 1] : null),
    macdSignal: round(signalSeries.length ? signalSeries[signalSeries.length - 1] : null),
    support20d: recentCloses.length ? round(Math.min(...recentCloses)) : null,
    resistance20d: recentCloses.length ? round(Math.max(...recentCloses)) : null,
    averageVolume20d: round(averageVolume20d, 0),
    volumeTrend,
    priceMomentum20dPct: round(momentum, 1),
  };
}

/** Format large INR numbers with Cr/Lakh suffixes */
export function formatInrCr(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return 'N/A';
  const crore = value / 1e7;
  if (Math.abs(crore) >= 1e5) return `₹${(crore / 1e5).toFixed(2)} Lakh Cr`;
  if (Math.abs(crore) >= 1) return `₹${crore.toFixed(0)} Cr`;
  return `₹${value.toFixed(2)}`;
}

/** Format percentage values */
export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value == null || isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Format a ratio (PE, PB etc.) */
export function formatRatio(value: number | null | undefined, decimals = 1): string {
  if (value == null || isNaN(value)) return 'N/A';
  return `${value.toFixed(decimals)}x`;
}

/**
 * Fetch daily historical candles from Yahoo Finance as a high-reliability fallback
 */
export async function fetchYahooHistoricalCandles(
  ticker: string,
  exchange: 'NSE' | 'BSE' = 'NSE',
  from?: Date,
): Promise<Array<{
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number;
}>> {
  try {
    const yf = getYF();
    const symbol = await resolveYahooSymbol(ticker, exchange);
    if (!symbol) return [];

    const period1 = from ?? new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const chart = await yf.chart(symbol, {
      period1,
      interval: '1d',
    }).catch(() => null);

    const quotes = Array.isArray(chart?.quotes) ? chart.quotes : [];
    return quotes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((q: any) => q && q.date && Number.isFinite(q.close) && Number.isFinite(q.open))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((q: any) => ({
        timestamp: new Date(q.date).toISOString(),
        open: Number(q.open),
        high: Number(q.high ?? q.close),
        low: Number(q.low ?? q.close),
        close: Number(q.close),
        volume: Number(q.volume ?? 0),
        openInterest: 0,
      }));
  } catch (err) {
    console.warn('[yahoo-finance] Historical candles fallback failed:', err);
    return [];
  }
}
