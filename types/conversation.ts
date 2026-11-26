import type { CompanyIdentity } from './company';
import type { ResearchReport, ResearchSourceMeta } from './research';
import type { TechnicalAnalysisResult } from './technical';
import type { InvestmentDecisionResult, InvestorPositionInput } from './decision';
import type { RetrievedMemory } from './memory';
import type { ScreenerCandidateRow, ScreenerExecutionResult, ScreenerSpec } from './screener';

export type ResearchIntent =
  | 'company_research'
  | 'fundamental_analysis'
  | 'technical_analysis'
  | 'financial_statement_analysis'
  | 'results_analysis'
  | 'stock_comparison'
  | 'sector_analysis'
  | 'stock_discovery'
  | 'stock_screening'
  | 'market_analysis'
  | 'news_announcements'
  | 'management_promoter_analysis'
  | 'risk_assessment'
  | 'financial_education'
  | 'investment_decision'
  | 'sector_ranking'
  | 'mutual_fund_research'
  | 'investment_planning'
  | 'portfolio_analysis'
  | 'project_context'
  | 'follow_up';

export interface ScreeningFilters {
  marketCapMinCr?: number | null;
  marketCapMaxCr?: number | null;
  minRevenueGrowthPct?: number | null;
  minEarningsGrowthPct?: number | null;
  minRoePct?: number | null;
  minRocePct?: number | null;
  maxDebtToEquity?: number | null;
  minOperatingCashFlowCr?: number | null;
  minFreeCashFlowCr?: number | null;
  maxDistanceFrom52WeekLowPct?: number | null;
  minInstitutionalHoldingPct?: number | null;
  sector?: string | null;
  limit?: number | null;
}

export interface QueryClassification {
  intent: ResearchIntent;
  confidence: number;
  companies: string[];
  sector?: string | null;
  isFollowUp: boolean;
  requiresFreshData: boolean;
  screeningFilters?: ScreeningFilters;
  rationale?: string;
}

export interface ConversationContext {
  activeCompanies: CompanyIdentity[];
  activeSector?: string | null;
  lastIntent?: ResearchIntent;
  reports?: Record<string, ResearchReport>;
  lastComparisonTickers?: string[];
  investorProfile?: InvestorPositionInput & {
    objective?: string;
    monthlyInvestment?: number;
    riskTolerance?: 'low' | 'moderate' | 'high';
  };
  lastDecision?: InvestmentDecisionResult;
  selectedTimeframe?: string | null;
  currentTask?: string | null;
  activeAssumptions?: string[];
  pendingClarifications?: string[];
  retrievedMemories?: RetrievedMemory[];
  conversationSummary?: string;
  activeScreenerSpec?: ScreenerSpec;
  activeScreenerRows?: ScreenerCandidateRow[];
}

export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MetricCardData {
  label: string;
  value: string;
  detail?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface ComparisonRow {
  metric: string;
  values: Record<string, string>;
}

export interface ScreeningResultRow {
  name: string;
  ticker: string;
  sector?: string | null;
  price: number;
  marketCapCr: number | null;
  revenueGrowthPct: number | null;
  earningsGrowthPct: number | null;
  roePct: number | null;
  debtToEquity: number | null;
  operatingCashFlowCr: number | null;
  freeCashFlowCr: number | null;
  distanceFrom52WeekLowPct: number | null;
  institutionalHoldingPct: number | null;
  technicalTrend?: 'bullish' | 'bearish' | 'sideways' | 'insufficient-data';
  rsi14?: number | null;
  aboveEma200?: boolean | null;
  relativeVolume?: number | null;
  support?: number | null;
  qualityScore?: number;
  qualityCategory?: 'high-quality candidate' | 'growth research candidate' | 'mixed-quality candidate' | 'higher-risk candidate';
  fetchedAt: string;
}

export type ConversationArtifact =
  | {
      kind: 'investment_decision';
      title: string;
      result: InvestmentDecisionResult;
    }
  | {
      kind: 'technical_analysis';
      title: string;
      result: TechnicalAnalysisResult;
    }
  | {
      kind: 'company_report';
      title: string;
      researchId: string;
      report: ResearchReport;
      metrics: MetricCardData[];
    }
  | {
      kind: 'comparison';
      title: string;
      companies: CompanyIdentity[];
      rows: ComparisonRow[];
      metrics: MetricCardData[];
    }
  | {
      kind: 'screening';
      title: string;
      rows: ScreeningResultRow[];
      universeSize: number;
      matchedCount: number;
      appliedFilters: string[];
      screenerResult?: ScreenerExecutionResult;
    };

export interface AssistantMessageData {
  intent?: ResearchIntent;
  sources?: ResearchSourceMeta[];
  artifact?: ConversationArtifact;
  suggestions?: string[];
  dataTimestamp?: string;
  context?: ConversationContext;
}
