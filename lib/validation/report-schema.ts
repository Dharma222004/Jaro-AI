import { z } from 'zod';
import type { ResearchReport } from '@/types/research';

export const FinancialMetricSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]).optional().default(null),
  unit: z.string().default(''),
  period: z.string().nullable().optional().default(null),
  asOf: z.string().nullable().optional(),
  basis: z.enum(['Consolidated', 'Standalone', 'Unspecified']).optional(),
  sourceId: z.string().nullable().optional(),
  metricType: z.enum(['reported', 'calculated']).optional(),
  formula: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const BusinessSegmentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  revenueShare: z.string().nullable().optional(),
  revenue: z.union([z.string(), z.number(), z.null()]).optional(),
  ebitda: z.union([z.string(), z.number(), z.null()]).optional(),
  margin: z.string().nullable().optional(),
  growth: z.string().nullable().optional(),
  keyDevelopments: z.string().nullable().optional(),
});

export const DevelopmentItemSchema = z.object({
  headline: z.string(),
  description: z.string().optional(),
  whatHappened: z.string().optional(),
  whyItMatters: z.string().optional(),
  date: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  category: z.string().optional(),
});

export const RiskItemSchema = z.object({
  category: z.string(),
  risk: z.string().optional(),
  description: z.string(),
  whyItMatters: z.string().optional(),
  evidence: z.string().optional(),
  severity: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  sourceId: z.string().nullable().optional(),
});

export const CommentaryItemSchema = z.object({
  speaker: z.string().nullable().optional(),
  quote: z.string(),
  context: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
});

export const ReportSourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  domain: z.string(),
  sourceType: z.string().default('other'),
  authority: z.enum(['high', 'medium', 'low']).optional(),
  publishedAt: z.string().nullable().optional(),
});

export const ConflictRecordSchema = z.object({
  metric: z.string(),
  selectedValue: z.union([z.string(), z.number(), z.null()]),
  selectedSource: z.string(),
  conflictingValues: z.array(z.object({
    value: z.union([z.string(), z.number(), z.null()]),
    source: z.string(),
    basis: z.string().optional(),
  })),
  resolution: z.string(),
});

export const DataQualityReportSchema = z.object({
  overallConfidence: z.enum(['High', 'Moderate', 'Limited']).default('Moderate'),
  confidenceReason: z.string().default(''),
  primarySourcesCount: z.number().default(0),
  secondarySourcesCount: z.number().default(0),
  conflictingMetricsCount: z.number().default(0),
  missingMetricsCount: z.number().default(0),
  conflicts: z.array(ConflictRecordSchema).default([]),
  missingMetrics: z.array(z.string()).default([]),
});

export const TechnicalAnalysisSchema = z.object({
  price: z.union([z.string(), z.number(), z.null()]).optional(),
  high52W: z.union([z.string(), z.number(), z.null()]).optional(),
  low52W: z.union([z.string(), z.number(), z.null()]).optional(),
  sma20: z.union([z.string(), z.number(), z.null()]).optional(),
  sma50: z.union([z.string(), z.number(), z.null()]).optional(),
  sma200: z.union([z.string(), z.number(), z.null()]).optional(),
  rsi: z.union([z.string(), z.number(), z.null()]).optional(),
  trend: z.string().optional(),
  observations: z.string().optional(),
});

export const ResearchReportSchema = z.object({
  company: z.object({
    name: z.string(),
    ticker: z.string(),
    exchange: z.string(),
    isin: z.string().optional(),
    sector: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    description: z.string(),
    website: z.string().nullable().optional(),
    marketCap: FinancialMetricSchema.optional(),
  }),
  business: z.object({
    businessModel: z.string(),
    products: z.array(z.string()).default([]),
    segments: z.array(BusinessSegmentSchema).default([]),
    geographies: z.array(z.string()).default([]),
    keySubsidiaries: z.array(z.string()).optional(),
  }),
  financials: z.object({
    revenue: FinancialMetricSchema,
    ebitda: FinancialMetricSchema,
    profit: FinancialMetricSchema,
    eps: FinancialMetricSchema,
    debt: FinancialMetricSchema,
    cash: FinancialMetricSchema,
    cashFlow: FinancialMetricSchema,
    revenueGrowth: FinancialMetricSchema.optional(),
    profitGrowth: FinancialMetricSchema.optional(),
    ebitdaGrowth: FinancialMetricSchema.optional(),
    epsGrowth: FinancialMetricSchema.optional(),
    operatingProfit: FinancialMetricSchema.optional(),
    netDebt: FinancialMetricSchema.optional(),
    debtToEquity: FinancialMetricSchema.optional(),
    freeCashFlow: FinancialMetricSchema.optional(),
    capex: FinancialMetricSchema.optional(),
    quarterlyTrend: z.array(z.any()).optional(),
    annualTrend: z.array(z.any()).optional(),
  }),
  profitability: z.object({
    roe: FinancialMetricSchema,
    roce: FinancialMetricSchema,
    netMargin: FinancialMetricSchema,
    ebitdaMargin: FinancialMetricSchema.optional(),
    operatingMargin: FinancialMetricSchema.optional(),
    grossMargin: FinancialMetricSchema.optional(),
    roa: FinancialMetricSchema.optional(),
  }),
  valuation: z.object({
    pe: FinancialMetricSchema,
    pb: FinancialMetricSchema,
    marketCap: FinancialMetricSchema,
    ev: FinancialMetricSchema.optional(),
    evEbitda: FinancialMetricSchema.optional(),
    dividendYield: FinancialMetricSchema.optional(),
    forwardPe: FinancialMetricSchema.optional(),
  }),
  shareholding: z.object({
    promoter: FinancialMetricSchema,
    fii: FinancialMetricSchema,
    dii: FinancialMetricSchema,
    public: FinancialMetricSchema,
    pledged: FinancialMetricSchema.optional(),
    asOfDate: z.string().nullable().optional(),
  }),
  balanceSheetAnalysis: z.string().optional(),
  cashFlowAnalysis: z.string().optional(),
  segmentAnalysis: z.array(BusinessSegmentSchema).optional(),
  recentDevelopments: z.array(DevelopmentItemSchema).default([]),
  growthDrivers: z.array(z.any()).default([]),
  futureCatalysts: z.array(z.string()).optional(),
  strengths: z.array(z.string()).default([]),
  risks: z.array(RiskItemSchema).default([]),
  managementCommentary: z.array(CommentaryItemSchema).default([]),
  technicalAnalysis: TechnicalAnalysisSchema.optional(),
  dataQuality: DataQualityReportSchema.optional(),
  researchSummary: z.string().default(''),
  sources: z.array(ReportSourceSchema).default([]),
  generatedAt: z.string(),
  queryAsked: z.string(),
  basisPreference: z.enum(['Consolidated', 'Standalone']).optional(),
});

export function validateResearchReport(data: unknown): ResearchReport {
  return ResearchReportSchema.parse(data) as ResearchReport;
}

export function sanitizeReportData(data: Record<string, unknown>, fallbackQuery = '', fallbackDate = new Date().toISOString()): Record<string, unknown> {
  const sanitized = { ...data };

  // Ensure top-level arrays exist
  if (!Array.isArray(sanitized.recentDevelopments)) sanitized.recentDevelopments = [];
  if (!Array.isArray(sanitized.growthDrivers)) sanitized.growthDrivers = [];
  if (!Array.isArray(sanitized.strengths)) sanitized.strengths = [];
  if (!Array.isArray(sanitized.risks)) sanitized.risks = [];
  if (!Array.isArray(sanitized.managementCommentary)) sanitized.managementCommentary = [];
  if (!Array.isArray(sanitized.sources)) sanitized.sources = [];

  // Ensure strings exist
  if (typeof sanitized.researchSummary !== 'string') {
    sanitized.researchSummary = typeof sanitized.summary === 'string' ? sanitized.summary : 'No research summary provided.';
  }
  if (typeof sanitized.generatedAt !== 'string') {
    sanitized.generatedAt = fallbackDate;
  }
  if (typeof sanitized.queryAsked !== 'string') {
    sanitized.queryAsked = fallbackQuery;
  }

  // Ensure metric structures don't have null instead of objects
  const defaultMetric = { value: null, unit: '', period: null };
  const categories = ['financials', 'profitability', 'valuation', 'shareholding'] as const;
  for (const cat of categories) {
    if (!sanitized[cat] || typeof sanitized[cat] !== 'object') {
      sanitized[cat] = {};
    }
  }

  return sanitized;
}

export function safeValidateResearchReport(data: unknown): {
  success: true; data: ResearchReport;
} | {
  success: false; errors: string[]; data: ResearchReport;
} {
  try {
    const sanitized = typeof data === 'object' && data !== null ? sanitizeReportData(data as Record<string, unknown>) : {};
    const result = ResearchReportSchema.safeParse(sanitized);
    if (result.success) {
      return { success: true, data: result.data as ResearchReport };
    }
    const errors = result.error.issues.map((e) => `${e.path.map(String).join('.')}: ${e.message}`);
    return { success: false, errors, data: sanitized as unknown as ResearchReport };
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : 'Validation failed'],
      data: data as ResearchReport,
    };
  }
}
