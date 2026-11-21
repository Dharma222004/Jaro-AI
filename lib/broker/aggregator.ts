import type {
  BrokerCandle,
  BrokerProviderName,
  BrokerQuote,
  MarketDataProvider,
  ProviderHealth,
} from './types';
import { UpstoxProvider } from './upstox-provider';
import { AngelOneProvider } from './angel-provider';
import { MStockProvider } from './mstock-provider';

export class MarketDataAggregator {
  private providers: MarketDataProvider[];

  constructor() {
    this.providers = [
      new UpstoxProvider(),
      new AngelOneProvider(),
      new MStockProvider(),
    ];
  }

  async getUnifiedQuote(symbol: string, exchange: 'NSE' | 'BSE' = 'NSE', isin?: string): Promise<BrokerQuote | null> {
    for (const provider of this.providers) {
      try {
        const quote = await provider.getQuote(symbol, exchange, isin);
        if (quote && Number.isFinite(quote.lastPrice) && quote.lastPrice > 0) {
          return quote;
        }
      } catch (err) {
        console.warn(`[broker-aggregator] ${provider.name} quote failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }
    return null;
  }

  async getUnifiedHistoricalCandles(params: {
    symbol: string;
    exchange?: 'NSE' | 'BSE';
    timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1mo';
    from: Date;
    to?: Date;
    isin?: string;
  }): Promise<{ candles: BrokerCandle[]; provider: BrokerProviderName | null }> {
    for (const provider of this.providers) {
      try {
        const candles = await provider.getHistoricalCandles(params);
        if (candles.length > 0) {
          return { candles, provider: provider.name };
        }
      } catch (err) {
        console.warn(`[broker-aggregator] ${provider.name} candles failed for ${params.symbol}:`, err instanceof Error ? err.message : err);
      }
    }
    return { candles: [], provider: null };
  }

  async getAllProvidersHealth(): Promise<ProviderHealth[]> {
    return Promise.all(this.providers.map((p) => p.checkHealth()));
  }
}

// Global singleton
const globalForAggregator = globalThis as unknown as { __marketDataAggregator?: MarketDataAggregator };
export const brokerAggregator = globalForAggregator.__marketDataAggregator ?? new MarketDataAggregator();
if (process.env.NODE_ENV !== 'production') globalForAggregator.__marketDataAggregator = brokerAggregator;
