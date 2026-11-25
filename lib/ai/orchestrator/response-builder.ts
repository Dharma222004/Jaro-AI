// lib/ai/orchestrator/response-builder.ts
// Structured financial response envelopes and formatting utilities.

import type { ResearchIntent } from '@/types/conversation';
import type { ResearchSourceMeta } from '@/types/research';
import type { ToolProvenance } from '@/lib/execution/tool-schemas';
import { formatIstDateTime, labelMarketDataStatus } from '@/lib/validation/financial-accuracy';

export interface StructuredStockAnalysisResponse {
  responseType: 'stock_analysis' | 'technical_analysis' | 'fundamental_analysis' | 'market_overview' | 'stock_comparison' | 'portfolio_research' | 'financial_education' | 'general_conversation';
  company: string | null;
  symbol: string | null;
  exchange: string | null;
  analysis_timestamp: string;
  analysis_timestamp_ist: string;
  market_data_status: string;
  current_market_data: Record<string, unknown>;
  technical_analysis: Record<string, unknown>;
  fundamental_analysis: Record<string, unknown>;
  key_observations: string[];
  risks: string[];
  sources: Array<{ id?: string; title: string; domain: string; url: string; retrievedAt: string }>;
  limitations: string[];
  conclusion: string;
}

export function buildStructuredResponseEnvelope(params: {
  intent: ResearchIntent;
  companyName?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  marketDataStatus?: string | null;
  dataTimestamp?: string | null;
  sources?: ResearchSourceMeta[];
  provenanceList?: ToolProvenance[];
  limitations?: string[];
  conclusion?: string;
}): StructuredStockAnalysisResponse {
  const nowIso = new Date().toISOString();
  const statusInfo = labelMarketDataStatus(params.marketDataStatus, params.dataTimestamp);

  const responseType: StructuredStockAnalysisResponse['responseType'] =
    params.intent === 'technical_analysis' ? 'technical_analysis' :
    params.intent === 'fundamental_analysis' || params.intent === 'financial_statement_analysis' ? 'fundamental_analysis' :
    params.intent === 'market_analysis' ? 'market_overview' :
    params.intent === 'stock_comparison' ? 'stock_comparison' :
    params.intent === 'portfolio_analysis' ? 'portfolio_research' :
    params.intent === 'financial_education' || params.intent === 'investment_planning' ? 'financial_education' :
    params.ticker ? 'stock_analysis' : 'general_conversation';

  return {
    responseType,
    company: params.companyName ?? null,
    symbol: params.ticker ?? null,
    exchange: params.exchange ?? null,
    analysis_timestamp: nowIso,
    analysis_timestamp_ist: formatIstDateTime(nowIso),
    market_data_status: statusInfo.label,
    current_market_data: {
      dataTimestampIst: params.dataTimestamp ? formatIstDateTime(params.dataTimestamp) : null,
      freshness: statusInfo.status,
      providers: [...new Set((params.provenanceList ?? []).map((p) => p.provider))],
    },
    technical_analysis: {},
    fundamental_analysis: {},
    key_observations: [],
    risks: [],
    sources: (params.sources ?? []).slice(0, 12).map((s) => ({
      id: s.id,
      title: s.title,
      domain: s.domain,
      url: s.url,
      retrievedAt: s.retrievedAt,
    })),
    limitations: params.limitations ?? [],
    conclusion: params.conclusion ?? 'Research synthesis complete.',
  };
}
