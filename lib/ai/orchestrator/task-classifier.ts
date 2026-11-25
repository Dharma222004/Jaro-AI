// lib/ai/orchestrator/task-classifier.ts
// Classifies user queries into explicit execution paths and complexity tiers before dispatching tools.

import {
  classifyDomain,
  classifyInvestmentDecisionQuery,
  classifyResearchQuery,
  extractFallbackCompanies,
  isInvestmentDecisionQuery,
} from '@/lib/research/query-classifier';
import { resolveCompanyFromQuery } from '@/lib/research/orchestrator';
import { determineTaskComplexity, selectModel, type ModelRouteSelection } from '@/lib/ai/model-router';
import type { ConversationContext, QueryClassification } from '@/types/conversation';

export type ExecutionPath =
  | 'simple_conversation'
  | 'out_of_domain'
  | 'stock_research'
  | 'advanced_research'
  | 'portfolio_analysis';

export interface PlannedTask {
  path: ExecutionPath;
  classification: QueryClassification;
  modelRoute: ModelRouteSelection;
  requiresMarketData: boolean;
  requiresResearchTools: boolean;
  plannedTools: string[];
  isGreeting: boolean;
}

const GREETING_RE = /^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening|day)|sup|namaste|whats\s*up|who\s*are\s*you|what\s*can\s*you\s*do|help|start|how\s*are\s*you|how\s*do\s*you\s*do|hi\s*there|hello\s*there)$/i;

export function isSimpleGreeting(query: string): boolean {
  const clean = query.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
  return GREETING_RE.test(clean);
}

export async function planExecutionTask(params: {
  query: string;
  context: ConversationContext;
  hasDocuments: boolean;
}): Promise<PlannedTask> {
  const { query, context, hasDocuments } = params;

  // Fast-path 1: Conversational greeting (0 LLM classification cost, 0 external APIs)
  if (isSimpleGreeting(query)) {
    const modelRoute = selectModel({ complexity: 'simple', intent: 'financial_education' });
    return {
      path: 'simple_conversation',
      classification: {
        intent: 'financial_education',
        confidence: 1,
        companies: [],
        sector: null,
        isFollowUp: false,
        requiresFreshData: false,
        screeningFilters: {},
        rationale: 'Greeting fast-path',
      },
      modelRoute,
      requiresMarketData: false,
      requiresResearchTools: false,
      plannedTools: [],
      isGreeting: true,
    };
  }

  let classification = isInvestmentDecisionQuery(query, context)
    ? classifyInvestmentDecisionQuery(query, context)
    : await classifyResearchQuery(query, context);

  if (/\bSIP\b|\bmutual funds?\b|\bindex funds?\b|\b(?:flexi|multi|small|mid|large)[ -]?cap funds?\b/i.test(query)) {
    classification = { ...classification, intent: 'mutual_fund_research' };
  }
  if (
    classification.companies.length === 0 &&
    /\b(where\s*(?:should|to|can)\s*i\s*invest|how\s*(?:should|to|can|do)\s*i\s*invest|want\s*to\s*invest|have\s+.*(?:rupees?|rs|inr|\d+).*invest|invest\s+(?:my\s+)?money|investing\s+advice|investment\s+advice|how\s*to\s*start\s*investing|invest\s+(?:for\s+)?beginners?|start\s*investing)\b/i.test(query)
  ) {
    classification = { ...classification, intent: 'investment_planning' };
  }

  // Domain check with listed-company safety rescue
  let domain = classifyDomain(query);
  if (domain.domain === 'non_finance') {
    const rescue = await resolveCompanyFromQuery(query);
    if (rescue.resolved && rescue.company) {
      domain = { domain: 'finance', confidence: 0.99, reason: `Resolved company: ${rescue.company.name}` };
      classification = {
        ...classification,
        intent: classification.intent === 'financial_education' ? 'company_research' : classification.intent,
        companies: [rescue.company.ticker],
      };
    } else {
      return {
        path: 'out_of_domain',
        classification,
        modelRoute: selectModel({ complexity: 'simple', intent: classification.intent }),
        requiresMarketData: false,
        requiresResearchTools: false,
        plannedTools: [],
        isGreeting: false,
      };
    }
  }

  // Fallback company extraction safety net
  const hasExplicitCompany = classification.companies.length > 0;
  const hasContextCompany = context.activeCompanies.length > 0 && (classification.isFollowUp || isInvestmentDecisionQuery(query, context));
  if (!hasExplicitCompany && !hasContextCompany) {
    const fallbackTickers = extractFallbackCompanies(query, context);
    if (fallbackTickers.length > 0) {
      classification = { ...classification, companies: fallbackTickers };
    }
  }

  const complexity = determineTaskComplexity({
    intent: classification.intent,
    query,
    companyCount: classification.companies.length,
    hasDocuments,
  });
  const modelRoute = selectModel({ complexity, intent: classification.intent });

  if (classification.intent === 'portfolio_analysis') {
    return {
      path: 'portfolio_analysis',
      classification,
      modelRoute,
      requiresMarketData: false,
      requiresResearchTools: true,
      plannedTools: ['get_user_portfolio', 'optimize_user_portfolio'],
      isGreeting: false,
    };
  }

  const isEducationalNoCompanyConcept =
    ['technical_analysis', 'fundamental_analysis'].includes(classification.intent) &&
    classification.companies.length === 0 &&
    /^\s*(?:what\s+(?:is|are)|explain|define|meaning\s+of|definition\s+of|how\s+does)\b/i.test(query) &&
    !/\b(nifty|sensex|bank\s*nifty|market|sector)\b/i.test(query);

  if (
    (['financial_education', 'investment_planning', 'mutual_fund_research', 'project_context'].includes(classification.intent) &&
      classification.companies.length === 0) ||
    isEducationalNoCompanyConcept
  ) {
    return {
      path: 'simple_conversation',
      classification,
      modelRoute,
      requiresMarketData: false,
      requiresResearchTools: false,
      plannedTools: hasDocuments ? ['search_financial_documents'] : [],
      isGreeting: false,
    };
  }

  const isAdvanced =
    classification.intent === 'stock_comparison' ||
    classification.intent === 'stock_screening' ||
    classification.intent === 'stock_discovery' ||
    classification.companies.length >= 2 ||
    (/\b(fundamental|financial statement|ratio|historical|technical)\b/i.test(query) && classification.companies.length > 0);

  return {
    path: isAdvanced ? 'advanced_research' : 'stock_research',
    classification,
    modelRoute,
    requiresMarketData: true,
    requiresResearchTools: true,
    plannedTools: isAdvanced
      ? ['resolve_company', 'get_company_research', 'get_historical_ohlcv', 'analyse_market_indices']
      : ['resolve_company', 'get_stock_quote', 'get_technical_indicators'],
    isGreeting: false,
  };
}
