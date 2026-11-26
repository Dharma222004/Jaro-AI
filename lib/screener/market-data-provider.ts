// lib/screener/market-data-provider.ts
// Multi-provider batched market data, completed-candle technical indicator calculation,
// and fundamental/market-cap retrieval for the Stock Screener Engine.

import { getFullMarketQuotes, type UpstoxFullQuote } from '@/lib/upstox/market-data';
import { getUpstoxConfiguration } from '@/lib/upstox/client';
import { getHistoricalCandles } from '@/lib/upstox/candles';
import { calculateIndicators } from '@/lib/technical/indicators';
import { fetchLiveMarketData, fetchYahooHistoricalCandles, type LiveMarketData } from '@/lib/yahoo-finance/client';
import { brokerAggregator } from '@/lib/broker/aggregator';
import type { MarketCandle, UpstoxInstrument } from '@/types/technical';
import type {
  CanonicalEquityInstrument,
  ScreenerCandidateRow,
  ScreenerCondition,
  ScreenerDataFreshness,
  ScreenerSpec,
} from '@/types/screener';

const UPSTOX_BATCH_SIZE = 500;
const QUOTE_CONCURRENCY = 8;
const DEEP_SCAN_CONCURRENCY = 6;
// Budget keeps interactive chat screening responsive on serverless/local runtimes
const MAX_YAHOO_FALLBACK_UNIVERSE = 120;

export function isNseMarketOpenIst(now = new Date()): boolean {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function getLatestIstDateStr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Separates completed daily candles from an in-progress intraday bar when
 * screening completed-session technicals/volume during market hours.
 */
function selectSessionCandles(candles: MarketCandle[], includeIntradaySession: boolean): MarketCandle[] {
  if (!candles.length || includeIntradaySession || !isNseMarketOpenIst()) {
    return candles;
  }
  const todayIst = getLatestIstDateStr();
  const last = candles[candles.length - 1];
  const lastDateIst = getLatestIstDateStr(new Date(last.timestamp));
  if (lastDateIst === todayIst && candles.length > 1) {
    return candles.slice(0, -1);
  }
  return candles;
}

function smaArrayTail(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

export function specNeedsTechnicalCandles(spec: ScreenerSpec): boolean {
  const candleFields = new Set([
    'sma_5', 'sma_10', 'sma_20', 'sma_50', 'sma_100', 'sma_200',
    'ema_9', 'ema_20', 'ema_50', 'ema_100', 'ema_200',
    'diff_from_sma_50_pct', 'rsi_14', 'macd_above_signal', 'macd_bullish_crossover',
    'stochastic_k', 'atr_pct', 'bb_width_pct', 'bb_contraction',
    'higher_highs_lows', 'support_retest', 'resistance_breakout',
    'avg_volume_5d', 'avg_volume_20d', 'avg_volume_50d', 'relative_volume',
  ]);
  return spec.conditions.some(
    (c) => candleFields.has(c.field) || (c.referenceField != null && candleFields.has(c.referenceField)),
  );
}

export function specNeedsFundamentals(spec: ScreenerSpec): boolean {
  const fundFields = new Set([
    'market_cap_cr', 'roe_pct', 'roce_pct', 'roa_pct', 'gross_margin_pct',
    'ebitda_margin_pct', 'operating_margin_pct', 'net_margin_pct',
    'revenue_growth_pct', 'operating_profit_growth_pct', 'net_profit_growth_pct',
    'eps_growth_pct', 'cagr_3y_pct', 'cagr_5y_pct', 'debt_to_equity',
    'current_ratio', 'interest_coverage', 'operating_cash_flow_cr', 'free_cash_flow_cr',
    'net_debt_cr', 'pe', 'pb', 'ev_to_ebitda', 'peg', 'dividend_yield_pct',
    'promoter_holding_pct', 'promoter_pledge_pct', 'fii_holding_pct', 'dii_holding_pct',
  ]);
  return Boolean(spec.sector) || spec.conditions.some((c) => fundFields.has(c.field));
}

function passesCheapQuotePreFilter(
  conditions: ScreenerCondition[],
  price: number,
  dailyVolume: number | null,
  marketCapCr: number | null,
  logicalOperator: 'AND' | 'OR',
): boolean {
  if (logicalOperator === 'OR') return true;
  // Cheap pre-filters only reject when a mandatory AND quote-level condition definitely fails
  for (const cond of conditions) {
    if (cond.field === 'daily_volume' && cond.value != null) {
      if (dailyVolume == null) return false;
      if (cond.operator === '>' && !(dailyVolume > cond.value)) return false;
      if (cond.operator === '>=' && !(dailyVolume >= cond.value)) return false;
      if (cond.operator === '<' && !(dailyVolume < cond.value)) return false;
      if (cond.operator === '<=' && !(dailyVolume <= cond.value)) return false;
    }
    if (cond.field === 'daily_turnover_cr' && cond.value != null && dailyVolume != null) {
      const turnoverCr = (price * dailyVolume) / 1e7;
      if (cond.operator === '>' && !(turnoverCr > cond.value)) return false;
      if (cond.operator === '>=' && !(turnoverCr >= cond.value)) return false;
      if (cond.operator === '<' && !(turnoverCr < cond.value)) return false;
      if (cond.operator === '<=' && !(turnoverCr <= cond.value)) return false;
    }
    if (cond.field === 'market_cap_cr' && cond.value != null && marketCapCr != null) {
      if (cond.operator === '>' && !(marketCapCr > cond.value)) return false;
      if (cond.operator === '>=' && !(marketCapCr >= cond.value)) return false;
      if (cond.operator === '<' && !(marketCapCr < cond.value)) return false;
      if (cond.operator === '<=' && !(marketCapCr <= cond.value)) return false;
      if (cond.operator === 'between' && cond.valueTo != null && (marketCapCr < cond.value || marketCapCr > cond.valueTo)) return false;
    }
  }
  return true;
}

export interface BatchScanOutput {
  candidates: ScreenerCandidateRow[];
  validQuoteCount: number;
  sufficientCandlesCount: number;
  verifiedMarketCapCount: number;
  providerBreakdown: Record<string, number>;
  exclusionReasons: Record<string, number>;
  warnings: string[];
}

/**
 * Executes batched multi-provider data collection for the canonical universe:
 * 1. Batched Upstox V3 quotes (up to 500 keys/request) if configured, else Yahoo/Angel/m.Stock batches.
 * 2. Cheap volume/turnover/market-cap pre-filtering before candle/fundamental fetch.
 * 3. Historical daily candles + local SMA/EMA/RSI/MACD/ATR calculation for surviving candidates.
 * 4. Fundamental + verified market-cap hydration where required.
 */
export async function collectScreenerMarketData(params: {
  universe: CanonicalEquityInstrument[];
  spec: ScreenerSpec;
  signal?: AbortSignal;
  onProgress?: (detail: string) => void;
}): Promise<BatchScanOutput> {
  const { universe, spec, signal, onProgress } = params;
  const providerBreakdown: Record<string, number> = {};
  const exclusionReasons: Record<string, number> = {};
  const warnings: string[] = [];

  const trackProvider = (name: string) => {
    providerBreakdown[name] = (providerBreakdown[name] ?? 0) + 1;
  };
  const trackExclusion = (reason: string) => {
    exclusionReasons[reason] = (exclusionReasons[reason] ?? 0) + 1;
  };

  const upstoxCfg = getUpstoxConfiguration();
  const includeIntraday = spec.volumeMode === 'intraday_cumulative';
  const needsCandles = specNeedsTechnicalCandles(spec);
  const needsFundamentals = specNeedsFundamentals(spec);
  const marketOpen = isNseMarketOpenIst();

  interface QuoteSeed {
    inst: CanonicalEquityInstrument;
    price: number;
    prevClose: number | null;
    volume: number | null;
    high52W: number | null;
    low52W: number | null;
    timestamp: string;
    provider: string;
    freshness: ScreenerDataFreshness;
    yahooData?: LiveMarketData | null;
  }

  const quoteSeeds: QuoteSeed[] = [];

  // Stage 1: Batched Quotes
  if (upstoxCfg.tokenConfigured) {
    const keyed = universe.filter((u) => {
      if (spec.exchanges === 'BSE') return Boolean(u.bseInstrumentKey);
      return Boolean(u.nseInstrumentKey || u.bseInstrumentKey);
    });
    const keyToInst = new Map<string, CanonicalEquityInstrument>();
    const allKeys: string[] = [];
    for (const u of keyed) {
      const k = spec.exchanges === 'BSE' ? (u.bseInstrumentKey ?? u.nseInstrumentKey) : (u.nseInstrumentKey ?? u.bseInstrumentKey);
      if (k) {
        keyToInst.set(k, u);
        allKeys.push(k);
      }
    }

    onProgress?.(`Fetching Upstox Full Market Quotes V3 in batches of ${UPSTOX_BATCH_SIZE} (${allKeys.length} instruments)`);
    for (let i = 0; i < allKeys.length; i += UPSTOX_BATCH_SIZE) {
      if (signal?.aborted) break;
      const chunk = allKeys.slice(i, i + UPSTOX_BATCH_SIZE);
      const res = await getFullMarketQuotes(chunk).catch(() => ({ quotes: {} as Record<string, UpstoxFullQuote>, cacheHit: false }));
      for (const [k, q] of Object.entries(res.quotes)) {
        const inst = keyToInst.get(k) ?? keyToInst.get(q.instrument_token);
        if (!inst || !q || !Number.isFinite(q.last_price) || q.last_price <= 0) continue;
        quoteSeeds.push({
          inst,
          price: q.last_price,
          prevClose: Number.isFinite(q.prev_close_price) ? q.prev_close_price : null,
          volume: Number.isFinite(q.volume) ? q.volume : null,
          high52W: Number.isFinite(q.year_high) && q.year_high > 0 ? q.year_high : null,
          low52W: Number.isFinite(q.year_low) && q.year_low > 0 ? q.year_low : null,
          timestamp: q.last_trade_time || q.timestamp || new Date().toISOString(),
          provider: 'upstox',
          freshness: res.cacheHit ? 'cached' : (marketOpen ? 'live' : 'latest_completed_session'),
        });
        trackProvider('upstox');
      }
    }
    if (quoteSeeds.length === 0) {
      warnings.push('Upstox batch quote retrieval returned 0 snapshots (check token/market session); switching to multi-provider fallback.');
    }
  } else {
    warnings.push('Upstox batch token is not configured; using supplementary Yahoo Finance & configured broker fallbacks with bounded universe coverage.');
  }

  // Fallback / supplementary quote hydration when Upstox didn't cover the universe
  if (quoteSeeds.length === 0) {
    const scanSlice = universe.slice(0, MAX_YAHOO_FALLBACK_UNIVERSE);
    if (universe.length > scanSlice.length) {
      warnings.push(`Evaluated ${scanSlice.length} liquid canonical equities out of ${universe.length} eligible securities due to supplementary provider rate limits.`);
    }

    onProgress?.(`Fetching batched market quotes & fundamentals for ${scanSlice.length} canonical equities`);
    for (let i = 0; i < scanSlice.length; i += QUOTE_CONCURRENCY) {
      if (signal?.aborted) break;
      const batch = scanSlice.slice(i, i + QUOTE_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (inst): Promise<QuoteSeed | null> => {
          const ex: 'NSE' | 'BSE' = spec.exchanges === 'BSE' && inst.bseCode ? 'BSE' : 'NSE';
          const sym = ex === 'BSE' ? (inst.bseCode ?? inst.primaryTicker) : (inst.nseSymbol ?? inst.primaryTicker);

          // Try Angel One / m.Stock aggregator first if configured, else Yahoo Finance
          const brokerQuote = await brokerAggregator.getUnifiedQuote(sym, ex, inst.isin ?? undefined).catch(() => null);
          const yf = await fetchLiveMarketData(sym, ex).catch(() => null);

          if (brokerQuote && brokerQuote.lastPrice > 0) {
            return {
              inst,
              price: brokerQuote.lastPrice,
              prevClose: brokerQuote.previousClose || null,
              volume: brokerQuote.volume || yf?.volume || null,
              high52W: yf?.high52w || null,
              low52W: yf?.low52w || null,
              timestamp: brokerQuote.timestamp,
              provider: brokerQuote.provider,
              freshness: marketOpen ? 'live' : 'latest_completed_session',
              yahooData: yf,
            };
          }

          if (yf && yf.price > 0) {
            return {
              inst,
              price: yf.price,
              prevClose: yf.previousClose || null,
              volume: Number.isFinite(yf.volume) ? yf.volume : null,
              high52W: yf.high52w > 0 ? yf.high52w : null,
              low52W: yf.low52w > 0 ? yf.low52w : null,
              timestamp: yf.fetchedAt,
              provider: 'yahoo_finance',
              freshness: 'delayed',
              yahooData: yf,
            };
          }

          return null;
        }),
      );

      for (const item of settled) {
        if (item.status === 'fulfilled' && item.value) {
          quoteSeeds.push(item.value);
          trackProvider(item.value.provider);
        } else {
          trackExclusion('Quote unavailable across providers');
        }
      }
    }
  }

  // Stage 2: Cheap quote-level pre-filter before expensive candle/fundamental calls
  const survivingSeeds = quoteSeeds.filter((seed) => {
    const mcapCr = seed.yahooData?.marketCap != null ? seed.yahooData.marketCap / 1e7 : null;
    const ok = passesCheapQuotePreFilter(spec.conditions, seed.price, seed.volume, mcapCr, spec.logicalOperator);
    if (!ok) trackExclusion('Failed quote-stage volume/turnover/market-cap pre-filter');
    return ok;
  });

  onProgress?.(`Computing indicators & verifying fundamentals for ${survivingSeeds.length} shortlisted candidates`);

  // Stage 3: Historical candles + local SMA/EMA/RSI/MACD/Volume + Fundamentals
  const candidates: ScreenerCandidateRow[] = [];
  let sufficientCandlesCount = 0;
  let verifiedMarketCapCount = 0;

  for (let i = 0; i < survivingSeeds.length; i += DEEP_SCAN_CONCURRENCY) {
    if (signal?.aborted) break;
    const batch = survivingSeeds.slice(i, i + DEEP_SCAN_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (seed): Promise<ScreenerCandidateRow> => {
        const { inst } = seed;
        const ex: 'NSE' | 'BSE' = spec.exchanges === 'BSE' && inst.bseCode ? 'BSE' : 'NSE';
        const sym = ex === 'BSE' ? (inst.bseCode ?? inst.primaryTicker) : (inst.nseSymbol ?? inst.primaryTicker);

        // Fetch fundamentals/market-cap when needed and not already hydrated
        let yf = seed.yahooData ?? null;
        if (needsFundamentals && !yf) {
          yf = await fetchLiveMarketData(sym, ex).catch(() => null);
        }

        // Fetch 1-year daily historical candles when technicals or average volume needed
        let rawCandles: MarketCandle[] = [];
        let candleProvider: string | null = null;
        if (needsCandles) {
          const from = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
          const upstoxKey = ex === 'BSE' ? inst.bseInstrumentKey : inst.nseInstrumentKey;
          if (upstoxCfg.tokenConfigured && upstoxKey) {
            const upstoxInst: UpstoxInstrument = {
              instrument_key: upstoxKey,
              trading_symbol: sym,
              name: inst.name,
              exchange: ex,
              segment: `${ex}_EQ`,
              instrument_type: 'EQ',
              isin: inst.isin ?? undefined,
            };
            const res = await getHistoricalCandles({ instrument: upstoxInst, timeframe: '1d', from }).catch(() => null);
            if (res?.candles.length) {
              rawCandles = res.candles;
              candleProvider = 'upstox';
            }
          }
          if (!rawCandles.length) {
            const yfCandles = await fetchYahooHistoricalCandles(sym, ex, from).catch(() => []);
            if (yfCandles.length) {
              rawCandles = yfCandles;
              candleProvider = 'yahoo_finance';
            }
          }
        }

        const sessionCandles = selectSessionCandles(rawCandles, includeIntraday);
        const closes = sessionCandles.map((c) => c.close);
        const vols = sessionCandles.map((c) => c.volume);
        const lastBar = sessionCandles.at(-1) ?? null;
        const prevBar = sessionCandles.length >= 2 ? sessionCandles[sessionCandles.length - 2] : null;

        const calculated = sessionCandles.length >= 20 ? calculateIndicators(sessionCandles, '1d') : null;
        if (sessionCandles.length >= 50) sufficientCandlesCount += 1;

        const sma5 = smaArrayTail(closes, 5);
        const sma10 = smaArrayTail(closes, 10);
        const sma20 = calculated?.snapshot.sma20 ?? smaArrayTail(closes, 20);
        const sma50 = calculated?.snapshot.sma50 ?? smaArrayTail(closes, 50);
        const sma100 = calculated?.snapshot.sma100 ?? smaArrayTail(closes, 100);
        const sma200 = calculated?.snapshot.sma200 ?? smaArrayTail(closes, 200);

        const prevSma50 = closes.length >= 51 ? smaArrayTail(closes.slice(0, -1), 50) : null;
        const prevCloseBelowSma50 = prevBar != null && prevSma50 != null ? prevBar.close <= prevSma50 : null;

        const refClose = lastBar?.close ?? seed.price;
        const diffFromSma50Pct = sma50 != null && sma50 > 0 ? ((refClose - sma50) / sma50) * 100 : null;

        const avgVol5d = smaArrayTail(vols, 5);
        const avgVol20d = calculated?.snapshot.averageVolume20 ?? smaArrayTail(vols, 20);
        const avgVol50d = smaArrayTail(vols, 50);

        const dailyVol = (!includeIntraday && lastBar && Number.isFinite(lastBar.volume))
          ? lastBar.volume
          : seed.volume;
        const turnoverCr = dailyVol != null ? (refClose * dailyVol) / 1e7 : null;

        // Verified Market Cap (INR Crore): direct provider field or price * sharesOutstanding
        let marketCapCr: number | null = null;
        let marketCapSource: string | null = null;
        const sharesOut = yf?.sharesOutstanding ?? null;
        if (yf?.marketCap != null && Number.isFinite(yf.marketCap) && yf.marketCap > 0) {
          marketCapCr = yf.marketCap / 1e7;
          marketCapSource = 'yahoo_finance';
          verifiedMarketCapCount += 1;
        } else if (sharesOut != null && Number.isFinite(sharesOut) && sharesOut > 0) {
          marketCapCr = (seed.price * sharesOut) / 1e7;
          marketCapSource = `${seed.provider}_price_x_shares`;
          verifiedMarketCapCount += 1;
        }

        const high52W = seed.high52W ?? yf?.high52w ?? (sessionCandles.length ? Math.max(...sessionCandles.slice(-252).map((c) => c.high)) : null);
        const low52W = seed.low52W ?? yf?.low52w ?? (sessionCandles.length ? Math.min(...sessionCandles.slice(-252).map((c) => c.low)) : null);
        const distHighPct = high52W && high52W > 0 ? ((high52W - refClose) / high52W) * 100 : null;
        const distLowPct = low52W && low52W > 0 ? ((refClose - low52W) / low52W) * 100 : null;

        const toPct = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v * 100 : null);
        const bbWidthPct =
          calculated?.snapshot.bollingerUpper != null &&
          calculated?.snapshot.bollingerLower != null &&
          calculated?.snapshot.bollingerMiddle
            ? ((calculated.snapshot.bollingerUpper - calculated.snapshot.bollingerLower) / calculated.snapshot.bollingerMiddle) * 100
            : null;

        const changePct = seed.prevClose && seed.prevClose > 0 ? ((seed.price - seed.prevClose) / seed.prevClose) * 100 : null;

        return {
          companyId: inst.companyId,
          isin: inst.isin,
          name: yf?.longName || inst.name,
          primaryTicker: inst.primaryTicker,
          nseSymbol: inst.nseSymbol,
          bseCode: inst.bseCode,
          exchangeLabel: inst.nseSymbol && inst.bseCode ? 'NSE/BSE' : (inst.bseCode && !inst.nseSymbol ? 'BSE' : 'NSE'),
          segment: inst.segment,
          sector: yf?.sector ?? inst.sector,
          industry: yf?.industry ?? inst.industry,

          price: refClose,
          previousClose: seed.prevClose,
          changePct,

          sma5,
          sma10,
          sma20,
          sma50,
          sma100,
          sma200,
          ema9: calculated?.snapshot.ema9 ?? null,
          ema20: calculated?.snapshot.ema20 ?? null,
          ema50: calculated?.snapshot.ema50 ?? null,
          ema100: calculated?.snapshot.ema100 ?? null,
          ema200: calculated?.snapshot.ema200 ?? null,
          diffFromSma50Pct,
          prevCloseBelowSma50,

          rsi14: calculated?.snapshot.rsi14 ?? null,
          macd: calculated?.snapshot.macd ?? null,
          macdSignal: calculated?.snapshot.macdSignal ?? null,
          macdHistogram: calculated?.snapshot.macdHistogram ?? null,
          stochasticK: calculated?.snapshot.stochasticK ?? null,
          atrPct: calculated?.snapshot.atrPct ?? null,
          bbWidthPct,

          dailyVolumeShares: dailyVol,
          dailyTurnoverCr: turnoverCr,
          avgVolume5d: avgVol5d,
          avgVolume20d: avgVol20d,
          avgVolume50d: avgVol50d,
          relativeVolume: calculated?.snapshot.relativeVolume ?? null,
          volumeMode: spec.volumeMode,

          high52W,
          low52W,
          distanceFrom52WeekHighPct: distHighPct,
          distanceFrom52WeekLowPct: distLowPct,
          higherHighsLows: calculated?.snapshot.structure === 'higher-highs-higher-lows' ? true : calculated ? false : null,
          supportLevel: calculated?.snapshot.support ?? null,
          resistanceLevel: calculated?.snapshot.resistance ?? null,

          marketCapCr,
          marketCapSource,
          sharesOutstanding: sharesOut,

          roePct: toPct(yf?.returnOnEquity),
          rocePct: null, // Not directly exposed by Yahoo quoteSummary; handled transparently
          roaPct: toPct(yf?.returnOnAssets),
          grossMarginPct: toPct(yf?.grossMargins),
          ebitdaMarginPct: toPct(yf?.ebitdaMargins),
          operatingMarginPct: toPct(yf?.operatingMargins),
          netMarginPct: toPct(yf?.profitMargins),
          revenueGrowthPct: toPct(yf?.revenueGrowth),
          operatingProfitGrowthPct: null,
          netProfitGrowthPct: toPct(yf?.earningsGrowth),
          epsGrowthPct: toPct(yf?.earningsGrowth),
          cagr3yPct: null,
          cagr5yPct: null,
          debtToEquity: yf?.debtToEquity != null && Number.isFinite(yf.debtToEquity) ? yf.debtToEquity / 100 : null,
          currentRatio: yf?.currentRatio ?? null,
          interestCoverage: null,
          operatingCashFlowCr: yf?.operatingCashflow != null ? yf.operatingCashflow / 1e7 : null,
          freeCashFlowCr: yf?.freeCashflow != null ? yf.freeCashflow / 1e7 : null,
          netDebtCr: yf?.totalDebt != null && yf?.totalCash != null ? (yf.totalDebt - yf.totalCash) / 1e7 : null,
          pe: yf?.trailingPE ?? null,
          pb: yf?.priceToBook ?? null,
          evToEbitda: yf?.evEbitda ?? null,
          peg: null,
          dividendYieldPct: toPct(yf?.dividendYield),
          promoterHoldingPct: toPct(yf?.heldPercentInsiders),
          promoterPledgePct: null,
          fiiHoldingPct: null,
          diiHoldingPct: toPct(yf?.heldPercentInstitutions),
          fundamentalPeriod: yf ? 'TTM / Latest Reported' : null,
          fundamentalBasis: yf ? 'consolidated' : null,

          quoteProvider: seed.provider,
          candleProvider,
          fundamentalProvider: yf ? 'yahoo_finance' : null,
          dataFreshness: seed.freshness,
          priceTimestamp: seed.timestamp,
          candleDate: lastBar ? getLatestIstDateStr(new Date(lastBar.timestamp)) : null,

          conditionResults: [],
          matched: false,
          missingData: [],
        };
      }),
    );

    for (const item of settled) {
      if (item.status === 'fulfilled') candidates.push(item.value);
    }
  }

  return {
    candidates,
    validQuoteCount: quoteSeeds.length,
    sufficientCandlesCount,
    verifiedMarketCapCount,
    providerBreakdown,
    exclusionReasons,
    warnings,
  };
}
