// Source metadata
export interface ResearchSourceMeta {
  id?: string;
  url: string;
  title: string;
  domain: string;
  sourceType: 'annual_report' | 'exchange_filing' | 'investor_presentation' | 'financial_database' | 'news' | 'analysis' | 'other';
  authority: 'high' | 'medium' | 'low';
  relevance?: number;
  publishedAt?: string;
  retrievedAt: string;
  snippet?: string;
  supportedMetrics?: string[];
}

// Research stage progress
export interface ResearchStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
}

// Research request
export interface ResearchRequest {
  query: string;
  forceRefresh?: boolean;
}

// Research response
export interface ResearchResponse {
  researchId: string;
  status: 'completed' | 'failed' | 'running';
  company?: import('./company').CompanyIdentity;
  report?: ResearchReport;
  sources?: ResearchSourceMeta[];
  error?: string;
  processingMs?: number;
  fromCache?: boolean;
}

// Financial metric structure with period, basis & audit trail
export interface FinancialMetric {
  value: string | number | null;
  unit: string;
  period?: string | null;
  asOf?: string | null;
  basis?: 'Consolidated' | 'Standalone' | 'Unspecified';
  sourceId?: string | null;
  metricType?: 'reported' | 'calculated' | 'estimated';
  formula?: string | null;
  note?: string | null;
  currency?: string | null;
  statementType?: 'consolidated' | 'standalone' | 'unspecified';
  sourceName?: string | null;
  sourceUrl?: string | null;
  publicationDate?: string | null;
  retrievedAt?: string | null;
  verificationStatus?: 'verified' | 'cross_checked' | 'calculated' | 'estimated' | 'unverified' | 'not_reported' | 'unavailable' | 'not_applicable';
  confidence?: 'high' | 'moderate' | 'limited';
}

export interface BusinessSegment {
  name: string;
  description?: string;
  revenueShare?: string | null;
  revenue?: string | number | null;
  ebitda?: string | number | null;
  margin?: string | null;
  growth?: string | null;
  keyDevelopments?: string | null;
}

export interface DevelopmentItem {
  headline: string;
  description?: string;
  whatHappened?: string;
  whyItMatters?: string;
  date?: string | null;
  sourceId?: string | null;
  category?: string;
}

export interface RiskItem {
  category: string;
  risk?: string;
  description: string;
  whyItMatters?: string;
  evidence?: string;
  severity?: 'high' | 'medium' | 'low';
  sourceId?: string | null;
}

export interface CommentaryItem {
  speaker?: string | null;
  quote: string;
  context?: string | null;
  date?: string | null;
  sourceId?: string | null;
}

export interface GrowthDriverItem {
  driver: string;
  evidence?: string;
  category?: string;
}

export interface ConflictRecord {
  metric: string;
  selectedValue: string | number | null;
  selectedSource: string;
  conflictingValues: Array<{
    value: string | number | null;
    source: string;
    basis?: string;
  }>;
  resolution: string;
}

export interface DataQualityReport {
  overallConfidence: 'High' | 'Moderate' | 'Limited';
  confidenceReason: string;
  primarySourcesCount: number;
  secondarySourcesCount: number;
  conflictingMetricsCount: number;
  missingMetricsCount: number;
  conflicts: ConflictRecord[];
  missingMetrics: string[];
  basisWarnings?: string[];
  metricAudit?: MetricAuditRecord[];
}

export interface MetricAuditRecord {
  metric: string;
  value: string | number | null;
  unit: string;
  period?: string | null;
  basis?: string | null;
  currency?: string | null;
  statementType?: FinancialMetric['statementType'];
  sourceId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  publicationDate?: string | null;
  retrievedAt?: string | null;
  verificationStatus: FinancialMetric['verificationStatus'];
  confidence?: FinancialMetric['confidence'];
  formula?: string | null;
  note?: string | null;
}

export interface TechnicalAnalysis {
  price?: number | string | null;
  high52W?: number | string | null;
  low52W?: number | string | null;
  sma20?: number | string | null;
  sma50?: number | string | null;
  sma200?: number | string | null;
  rsi?: number | string | null;
  macd?: number | string | null;
  macdSignal?: number | string | null;
  volume?: number | string | null;
  averageVolume20d?: number | string | null;
  volumeTrend?: string | null;
  support?: number | string | null;
  resistance?: number | string | null;
  priceMomentum20dPct?: number | string | null;
  trend?: 'Bullish' | 'Neutral' | 'Bearish' | string;
  observations?: string;
}

export interface ReportSource {
  id: string;
  url: string;
  title: string;
  domain: string;
  sourceType: string;
  authority?: 'high' | 'medium' | 'low';
  publishedAt?: string | null;
  retrievedAt?: string | null;
  supportedMetrics?: string[];
}

// Full structured equity research report JSON
export interface ResearchReport {
  reportVersion?: number;
  company: {
    name: string;
    ticker: string;
    exchange: string;
    isin?: string;
    sector?: string | null;
    industry?: string | null;
    description: string;
    website?: string | null;
    marketCap?: FinancialMetric;
  };

  business: {
    businessModel: string;
    products: string[];
    segments: BusinessSegment[];
    geographies: string[];
    keySubsidiaries?: string[];
  };

  financials: {
    revenue: FinancialMetric;
    ebitda: FinancialMetric;
    profit: FinancialMetric;
    eps: FinancialMetric;
    debt: FinancialMetric;
    cash: FinancialMetric;
    cashFlow: FinancialMetric;
    revenueGrowth?: FinancialMetric;
    profitGrowth?: FinancialMetric;
    ebitdaGrowth?: FinancialMetric;
    epsGrowth?: FinancialMetric;
    operatingProfit?: FinancialMetric;
    netDebt?: FinancialMetric;
    debtToEquity?: FinancialMetric;
    freeCashFlow?: FinancialMetric;
    capex?: FinancialMetric;
    currentRatio?: FinancialMetric;
    interestCoverage?: FinancialMetric;
    totalAssets?: FinancialMetric;
    totalLiabilities?: FinancialMetric;
    currentAssets?: FinancialMetric;
    currentLiabilities?: FinancialMetric;
    shareholdersEquity?: FinancialMetric;
    equityCapital?: FinancialMetric;
    reserves?: FinancialMetric;
    operatingCashFlow?: FinancialMetric;
    investingCashFlow?: FinancialMetric;
    financingCashFlow?: FinancialMetric;
    interestExpense?: FinancialMetric;
    ebit?: FinancialMetric;
    workingCapital?: FinancialMetric;
    // Historical trends if available
    quarterlyTrend?: Array<{
      period: string;
      revenue?: number | string | null;
      ebitda?: number | string | null;
      profit?: number | string | null;
      eps?: number | string | null;
      operatingProfit?: number | string | null;
      sourceId?: string | null;
      basis?: string | null;
    }>;
    annualTrend?: Array<{
      period: string;
      revenue?: number | string | null;
      ebitda?: number | string | null;
      profit?: number | string | null;
      eps?: number | string | null;
      operatingProfit?: number | string | null;
      sourceId?: string | null;
      basis?: string | null;
    }>;
  };

  profitability: {
    roe: FinancialMetric;
    roce: FinancialMetric;
    netMargin: FinancialMetric;
    ebitdaMargin?: FinancialMetric;
    operatingMargin?: FinancialMetric;
    grossMargin?: FinancialMetric;
    roa?: FinancialMetric;
  };

  valuation: {
    pe: FinancialMetric;
    pb: FinancialMetric;
    marketCap: FinancialMetric;
    ev?: FinancialMetric;
    evEbitda?: FinancialMetric;
    dividendYield?: FinancialMetric;
    forwardPe?: FinancialMetric;
  };

  shareholding: {
    promoter: FinancialMetric;
    fii: FinancialMetric;
    dii: FinancialMetric;
    public: FinancialMetric;
    pledged?: FinancialMetric;
    asOfDate?: string | null;
    history?: Array<{
      period: string;
      promoter?: number | null;
      fii?: number | null;
      dii?: number | null;
      public?: number | null;
      sourceId?: string | null;
      basis?: string | null;
    }>;
  };

  balanceSheetAnalysis?: string;
  cashFlowAnalysis?: string;
  segmentAnalysis?: BusinessSegment[];
  recentDevelopments: DevelopmentItem[];
  growthDrivers: string[];
  futureCatalysts?: string[];
  strengths: string[];
  risks: RiskItem[];
  managementCommentary: CommentaryItem[];
  technicalAnalysis?: TechnicalAnalysis;
  dataQuality?: DataQualityReport;
  researchSummary: string;
  sources: ReportSource[];

  // Metadata
  generatedAt: string;
  queryAsked: string;
  basisPreference?: 'Consolidated' | 'Standalone';
}

// History item
export interface ResearchHistoryItem {
  id: string;
  companyName: string;
  ticker: string;
  exchange: string;
  query: string;
  status: string;
  createdAt: string;
}

// Watchlist item
export interface WatchlistItem {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  exchange: string;
  addedAt: string;
  lastResearch?: string;
}
