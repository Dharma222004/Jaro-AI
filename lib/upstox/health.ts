import { getUpstoxConfiguration, getUpstoxRuntimeStatus, toPublicUpstoxError } from './client';
import { getHistoricalCandles } from './candles';
import { resolveUpstoxInstrument } from './instruments';
import { getFullMarketQuotes } from './market-data';

export interface UpstoxConnectionStatus {
  tokenConfigured: boolean;
  clientInitialized: boolean;
  configurationSource: 'canonical' | 'legacy_alias' | null;
  expectedVariable: 'UPSTOX_ANALYTICS_TOKEN';
  instrumentResolution: {
    status: 'success' | 'failure';
    exchange: string | null;
    tradingSymbol: string | null;
    instrumentKey: string | null;
    message?: string;
  };
  endpointTests: {
    historicalCandles: EndpointTest;
    fullMarketQuote: EndpointTest;
  };
  lastSuccessfulMarketDataRetrieval: string | null;
  lastErrorCategory: string | null;
  dataFreshness: 'fresh' | 'delayed' | 'stale' | 'unavailable' | 'not_tested';
  lastCandleAt: string | null;
}

interface EndpointTest {
  status: 'success' | 'failure' | 'not_tested';
  category: string | null;
  code: string | null;
  message: string;
}

export async function checkUpstoxConnection(query = 'GAIL', runEndpointTests = true): Promise<UpstoxConnectionStatus> {
  const configuration = getUpstoxConfiguration();
  const resolution = await resolveUpstoxInstrument(query, 'NSE').catch((error) => ({
    instrument: null,
    candidates: [],
    error: error instanceof Error ? error.message : 'Instrument master unavailable.',
  }));
  const instrument = resolution.instrument;
  const instrumentResolution: UpstoxConnectionStatus['instrumentResolution'] = instrument ? {
    status: 'success',
    exchange: instrument.exchange,
    tradingSymbol: instrument.trading_symbol,
    instrumentKey: instrument.instrument_key,
  } : {
    status: 'failure',
    exchange: null,
    tradingSymbol: null,
    instrumentKey: null,
    message: 'Could not resolve the selected stock to a valid exchange instrument.',
  };

  const notTested = (message: string): EndpointTest => ({ status: 'not_tested', category: null, code: null, message });
  let historicalCandles = notTested('Endpoint test was not requested.');
  let fullMarketQuote = notTested('Endpoint test was not requested.');
  let lastCandleAt: string | null = null;

  if (runEndpointTests && !configuration.tokenConfigured) {
    const missing: EndpointTest = {
      status: 'failure', category: 'token_missing', code: 'TOKEN_NOT_CONFIGURED',
      message: 'Upstox market-data credentials are not available in the backend environment.',
    };
    historicalCandles = missing;
    fullMarketQuote = missing;
  } else if (runEndpointTests && !instrument) {
    const invalid: EndpointTest = {
      status: 'failure', category: 'invalid_instrument', code: 'INSTRUMENT_NOT_RESOLVED',
      message: 'Could not resolve the selected stock to a valid exchange instrument.',
    };
    historicalCandles = invalid;
    fullMarketQuote = invalid;
  } else if (runEndpointTests && instrument) {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 14);
    const [candles, quote] = await Promise.allSettled([
      getHistoricalCandles({ instrument, timeframe: '1d', from }),
      getFullMarketQuotes([instrument.instrument_key]),
    ]);
    if (candles.status === 'fulfilled' && candles.value.candles.length > 0) {
      lastCandleAt = candles.value.candles.at(-1)?.timestamp ?? null;
      historicalCandles = {
        status: 'success', category: null, code: null,
        message: `${candles.value.candles.length} validated daily candles returned.`,
      };
    } else {
      historicalCandles = endpointFailure(candles.status === 'rejected' ? candles.reason : new Error('No candle data returned.'));
    }
    if (quote.status === 'fulfilled' && Object.keys(quote.value.quotes).length > 0) {
      fullMarketQuote = { status: 'success', category: null, code: null, message: 'Latest available quote returned.' };
    } else {
      fullMarketQuote = endpointFailure(quote.status === 'rejected' ? quote.reason : new Error('No quote data returned.'));
    }
  }

  const runtime = getUpstoxRuntimeStatus();
  const dataFreshness = freshness(lastCandleAt);
  return {
    ...configuration,
    instrumentResolution,
    endpointTests: { historicalCandles, fullMarketQuote },
    lastSuccessfulMarketDataRetrieval: runtime.lastSuccessfulAt,
    lastErrorCategory: runtime.lastErrorCategory
      ?? (historicalCandles.status === 'failure' ? historicalCandles.category : fullMarketQuote.status === 'failure' ? fullMarketQuote.category : null),
    dataFreshness: runEndpointTests ? dataFreshness : 'not_tested',
    lastCandleAt,
  };
}

function endpointFailure(error: unknown): EndpointTest {
  const safe = toPublicUpstoxError(error);
  return { status: 'failure', category: safe.category, code: safe.code, message: safe.message };
}

function freshness(lastCandleAt: string | null): UpstoxConnectionStatus['dataFreshness'] {
  if (!lastCandleAt) return 'unavailable';
  const age = Date.now() - new Date(lastCandleAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 'unavailable';
  if (age <= 3 * 24 * 60 * 60 * 1000) return 'fresh';
  if (age <= 7 * 24 * 60 * 60 * 1000) return 'delayed';
  return 'stale';
}
