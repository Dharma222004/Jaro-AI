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
    const [quote, summary] = await Promise.all([
      yf.quote(symbol).catch(() => null),
      yf.quoteSummary(symbol, {
        modules: ['financialData', 'defaultKeyStatistics', 'assetProfile'],
      }).catch(() => null),
    ]);

    if (!quote) return null;

    const fd = summary?.financialData ?? {};
    const dk = summary?.defaultKeyStatistics ?? {};
    const ap = summary?.assetProfile ?? {};

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
