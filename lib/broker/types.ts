export type BrokerProviderName = 'upstox' | 'angelone' | 'mstock';

export interface BrokerCandle {
  timestamp: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number;
}

export interface BrokerQuote {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  lastPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  yearHigh?: number;
  yearLow?: number;
  averagePrice?: number;
  timestamp: string;
  provider: BrokerProviderName;
}

export interface ProviderHealth {
  provider: BrokerProviderName;
  available: boolean;
  lastCheckedAt: string;
  latencyMs?: number;
  error?: string;
}

export interface MarketDataProvider {
  readonly name: BrokerProviderName;
  getQuote(symbol: string, exchange?: 'NSE' | 'BSE', isin?: string): Promise<BrokerQuote | null>;
  getHistoricalCandles(params: {
    symbol: string;
    exchange?: 'NSE' | 'BSE';
    timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1mo';
    from: Date;
    to?: Date;
    isin?: string;
  }): Promise<BrokerCandle[]>;
  checkHealth(): Promise<ProviderHealth>;
}
