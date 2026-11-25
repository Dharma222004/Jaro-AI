// lib/execution/tool-registry.ts
// Registry of explicitly permitted, schema-bound financial tools with timeouts and scopes.

import { z } from 'zod';
import { brokerAggregator } from '@/lib/broker/aggregator';
import { fetchLiveMarketData } from '@/lib/yahoo-finance/client';
import { runTechnicalAnalysis } from '@/lib/technical/engine';
import { resolveCompanyFromQuery, runResearchPipeline } from '@/lib/research/orchestrator';
import { screenIndianEquities } from '@/lib/research/conversational-collector';
import { hybridSearchChunks } from '@/lib/documents/store';
import { listPortfolioHoldings } from '@/lib/portfolio/store';
import { optimizePortfolio } from '@/lib/portfolio/optimization';
import { DEFAULT_PORTFOLIO_RISK_BUDGET } from '@/types/portfolio';
import {
  ToolInputSchemas,
  type DataFreshnessState,
  type RegisteredToolName,
} from './tool-schemas';
import type { ToolPermissionScope, ExecutionPrincipal } from './tool-permissions';

export interface ToolHandlerResult<T = unknown> {
  data: T;
  provider: string;
  source: string;
  dataTimestamp: string | null;
  dataFreshness: DataFreshnessState;
  cached?: boolean;
}

export interface RegisteredToolSpec<Name extends RegisteredToolName = RegisteredToolName> {
  name: Name;
  description: string;
  permissionScope: ToolPermissionScope;
  idempotent: boolean;
  timeoutMs: number;
  maxRetries: number;
  handler: (
    params: z.infer<(typeof ToolInputSchemas)[Name]>,
    principal: ExecutionPrincipal,
  ) => Promise<ToolHandlerResult>;
}

const REGISTRY: { [K in RegisteredToolName]: RegisteredToolSpec<K> } = {
  get_stock_quote: {
    name: 'get_stock_quote',
    description: 'Fetches verified latest quote for an NSE/BSE listed stock with currency, exchange, and freshness metadata.',
    permissionScope: 'public_market',
    idempotent: true,
    timeoutMs: 15_000,
    maxRetries: 1,
    handler: async (params) => {
      const retrievalTimestamp = new Date().toISOString();
      const [brokerQuote, marketSnapshot] = await Promise.all([
        brokerAggregator.getUnifiedQuote(params.symbol, params.exchange, params.isin).catch(() => null),
        fetchLiveMarketData(params.symbol, params.exchange).catch(() => null),
      ]);

      if (!brokerQuote && !marketSnapshot) {
        throw new Error(`Quote unavailable for ${params.exchange}:${params.symbol}`);
      }

      const price = brokerQuote?.lastPrice ?? marketSnapshot?.price ?? null;
      if (price == null || !Number.isFinite(price)) {
        throw new Error(`No verified numeric price available for ${params.exchange}:${params.symbol}`);
      }

      const isBroker = Boolean(brokerQuote);
      return {
        data: {
          symbol: params.symbol.toUpperCase(),
          exchange: params.exchange,
          currency: 'INR' as const,
          price,
          previousClose: brokerQuote?.previousClose ?? marketSnapshot?.previousClose ?? null,
          change: brokerQuote?.change ?? marketSnapshot?.priceChange ?? null,
          changePct: brokerQuote?.changePercent ?? marketSnapshot?.priceChangePct ?? null,
          dayHigh: brokerQuote?.high ?? marketSnapshot?.dayHigh ?? null,
          dayLow: brokerQuote?.low ?? marketSnapshot?.dayLow ?? null,
          volume: brokerQuote?.volume ?? marketSnapshot?.volume ?? null,
          high52w: brokerQuote?.yearHigh ?? marketSnapshot?.high52w ?? null,
          low52w: brokerQuote?.yearLow ?? marketSnapshot?.low52w ?? null,
          marketCap: marketSnapshot?.marketCap ?? null,
          trailingPE: marketSnapshot?.trailingPE ?? null,
          priceToBook: marketSnapshot?.priceToBook ?? null,
          timestamp: brokerQuote?.timestamp ?? marketSnapshot?.fetchedAt ?? retrievalTimestamp,
          source: isBroker ? `Exchange Market Feed (${brokerQuote!.provider})` : 'Delayed Financial Market Feed',
        },
        provider: isBroker ? brokerQuote!.provider : 'delayed_equity_feed',
        source: isBroker ? `${params.exchange} Broker Quote` : 'Exchange Delayed Snapshot',
        dataTimestamp: brokerQuote?.timestamp ?? marketSnapshot?.fetchedAt ?? null,
        dataFreshness: isBroker ? 'realtime' : 'delayed',
      };
    },
  },

  get_historical_ohlcv: {
    name: 'get_historical_ohlcv',
    description: 'Retrieves validated OHLCV candles and computes local technical indicators without synthetic data fabrication.',
    permissionScope: 'public_market',
    idempotent: true,
    timeoutMs: 25_000,
    maxRetries: 1,
    handler: async (params) => {
      const result = await runTechnicalAnalysis({
        query: params.symbol,
        exchange: params.exchange,
        timeframe: params.timeframe,
        isin: params.isin,
        from: params.fromIso ? new Date(params.fromIso) : undefined,
        requireFresh: params.requireFresh,
      });
      return {
        data: result,
        provider: 'exchange_candle_feed',
        source: `${result.instrument.exchange} Historical OHLCV`,
        dataTimestamp: result.lastCandleAt ?? null,
        dataFreshness: result.dataStatus === 'live' ? 'realtime' : result.dataStatus === 'delayed' ? 'delayed' : 'end_of_day',
        cached: result.cache?.hit ?? false,
      };
    },
  },

  get_technical_indicators: {
    name: 'get_technical_indicators',
    description: 'Computes deterministic RSI, MACD, SMA, EMA, Bollinger Bands, ATR, VWAP, ADX, and support/resistance from OHLCV candles.',
    permissionScope: 'public_market',
    idempotent: true,
    timeoutMs: 25_000,
    maxRetries: 1,
    handler: async (params) => {
      const result = await runTechnicalAnalysis({
        query: params.symbol,
        exchange: params.exchange,
        timeframe: params.timeframe,
        isin: params.isin,
        from: params.fromIso ? new Date(params.fromIso) : undefined,
        requireFresh: params.requireFresh,
      });
      return {
        data: result,
        provider: 'local_technical_engine',
        source: `${result.instrument.exchange} Technical Indicators`,
        dataTimestamp: result.lastCandleAt ?? null,
        dataFreshness: result.dataStatus === 'live' ? 'realtime' : result.dataStatus === 'delayed' ? 'delayed' : 'end_of_day',
        cached: result.cache?.hit ?? false,
      };
    },
  },

  resolve_company: {
    name: 'resolve_company',
    description: 'Resolves company names or tickers to verified NSE/BSE listed entities.',
    permissionScope: 'research_read',
    idempotent: true,
    timeoutMs: 20_000,
    maxRetries: 0,
    handler: async (params) => {
      const outcome = await resolveCompanyFromQuery(params.query);
      return {
        data: outcome,
        provider: 'company_resolver',
        source: 'NSE/BSE Securities Directory',
        dataTimestamp: new Date().toISOString(),
        dataFreshness: 'end_of_day',
      };
    },
  },

  get_company_research: {
    name: 'get_company_research',
    description: 'Executes source-backed fundamental, valuation, shareholding, and corporate disclosure research.',
    permissionScope: 'research_read',
    idempotent: true,
    timeoutMs: 120_000,
    maxRetries: 0,
    handler: async (params) => {
      const result = await runResearchPipeline({
        query: params.query,
        company: {
          ...params.company,
          sector: params.company.sector ?? undefined,
          industry: params.company.industry ?? undefined,
        },
        forceRefresh: params.forceRefresh,
      });
      if (result.status !== 'completed' || !result.report) {
        throw new Error(result.error ?? 'Company research pipeline failed.');
      }
      return {
        data: result,
        provider: 'tavily_screener_filings',
        source: 'Exchange Filings & Financial Disclosures',
        dataTimestamp: result.report.generatedAt,
        dataFreshness: 'end_of_day',
        cached: result.fromCache,
      };
    },
  },

  screen_indian_equities: {
    name: 'screen_indian_equities',
    description: 'Screens Indian equities by fundamental filters (ROE, ROCE, D/E, cash flow, growth, market cap).',
    permissionScope: 'research_read',
    idempotent: true,
    timeoutMs: 45_000,
    maxRetries: 0,
    handler: async (params) => {
      const cleanFilters = Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, v === null ? undefined : v]),
      );
      const res = await screenIndianEquities(cleanFilters);
      return {
        data: res,
        provider: 'equity_screener',
        source: 'Indian Equity Fundamental Universe',
        dataTimestamp: res.retrievedAt,
        dataFreshness: 'delayed',
      };
    },
  },

  analyse_market_indices: {
    name: 'analyse_market_indices',
    description: 'Analyses Indian market benchmarks (NIFTY 50, NIFTY BANK, SENSEX, INDIA VIX).',
    permissionScope: 'public_market',
    idempotent: true,
    timeoutMs: 25_000,
    maxRetries: 1,
    handler: async (params) => {
      const result = await runTechnicalAnalysis({
        query: params.indexName,
        exchange: 'NSE',
        timeframe: params.timeframe,
      });
      return {
        data: result,
        provider: 'index_technical_engine',
        source: `NSE Index Feed (${params.indexName})`,
        dataTimestamp: result.lastCandleAt ?? null,
        dataFreshness: result.dataStatus === 'live' ? 'realtime' : result.dataStatus === 'delayed' ? 'delayed' : 'end_of_day',
        cached: result.cache?.hit ?? false,
      };
    },
  },

  search_financial_documents: {
    name: 'search_financial_documents',
    description: 'Searches authenticated user-uploaded financial documents and indexed filings.',
    permissionScope: 'authenticated_private',
    idempotent: true,
    timeoutMs: 12_000,
    maxRetries: 0,
    handler: async (params, principal) => {
      const chunks = await hybridSearchChunks(principal.identity!, {
        query: params.query,
        documentIds: params.documentIds,
        companyId: params.companyId,
        topK: params.topK,
      });
      return {
        data: { chunks },
        provider: 'document_rag_store',
        source: 'Authenticated User Document Knowledge Base',
        dataTimestamp: new Date().toISOString(),
        dataFreshness: 'end_of_day',
      };
    },
  },

  get_user_portfolio: {
    name: 'get_user_portfolio',
    description: 'Retrieves authenticated user portfolio holdings with strict tenant isolation.',
    permissionScope: 'authenticated_private',
    idempotent: true,
    timeoutMs: 10_000,
    maxRetries: 0,
    handler: async (params, principal) => {
      const holdings = await listPortfolioHoldings(principal.identity!);
      const filtered = params.ticker
        ? holdings.filter((h) => h.ticker === params.ticker!.toUpperCase())
        : holdings;
      return {
        data: { holdings: filtered },
        provider: 'portfolio_db_store',
        source: 'Authenticated Portfolio Holdings',
        dataTimestamp: new Date().toISOString(),
        dataFreshness: 'end_of_day',
      };
    },
  },

  optimize_user_portfolio: {
    name: 'optimize_user_portfolio',
    description: 'Computes deterministic portfolio risk parity, sector exposure, and correlation adjustments.',
    permissionScope: 'authenticated_private',
    idempotent: true,
    timeoutMs: 10_000,
    maxRetries: 0,
    handler: async (params) => {
      const normalized = params.positions.map((p) => {
        const mv = p.quantity * p.currentPrice;
        return { ...p, marketValue: mv, weightPct: (mv / params.accountEquity) * 100 };
      });
      const result = optimizePortfolio({
        positions: normalized,
        availableCapital: params.availableCapital,
        accountEquity: params.accountEquity,
        riskBudget: DEFAULT_PORTFOLIO_RISK_BUDGET,
      });
      return {
        data: result,
        provider: 'portfolio_risk_engine',
        source: 'Deterministic Portfolio Risk Engine',
        dataTimestamp: result.generatedAt,
        dataFreshness: 'end_of_day',
      };
    },
  },
};

export function getRegisteredTool<K extends RegisteredToolName>(toolName: string): RegisteredToolSpec<K> | null {
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, toolName)) {
    return null;
  }
  return REGISTRY[toolName as K];
}

export function listRegisteredTools() {
  return Object.values(REGISTRY).map((t) => ({
    name: t.name,
    description: t.description,
    permissionScope: t.permissionScope,
    idempotent: t.idempotent,
    timeoutMs: t.timeoutMs,
  }));
}
