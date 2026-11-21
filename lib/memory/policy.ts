import type { ConversationContext, QueryClassification } from '@/types/conversation';
import type { MemoryCandidate, RetrievedMemory } from '@/types/memory';
import type { CompanyIdentity } from '@/types/company';

export function buildMemoryCandidates(params: {
  query: string;
  conversationId: string;
  sourceMessageId?: string;
  classification?: QueryClassification;
  context: ConversationContext;
}): MemoryCandidate[] {
  const { query, conversationId, sourceMessageId, classification, context } = params;
  const companies = context.activeCompanies.slice(0, 4);
  const entities = [
    ...companies.map((company) => company.ticker),
    ...(context.activeSector ? [context.activeSector] : []),
  ];
  const candidates: MemoryCandidate[] = [{
    type: 'working',
    eventType: 'conversation_context',
    conversationId,
    sourceMessageId,
    summary: workingSummary(classification, companies, context),
    entities,
    content: {
      companies,
      activeSector: context.activeSector ?? null,
      lastIntent: context.lastIntent ?? classification?.intent ?? null,
      selectedHorizon: context.investorProfile?.horizon ?? null,
      selectedTimeframe: context.selectedTimeframe ?? null,
      currentTask: context.currentTask ?? classification?.intent ?? null,
      activeAssumptions: context.activeAssumptions ?? [],
      pendingClarifications: context.pendingClarifications ?? [],
    },
    confidence: 0.95,
    importance: 0.7,
    expiresAt: daysFromNow(14),
  }];

  if (classification && shouldCreateEpisode(classification.intent)) {
    candidates.push({
      type: 'episodic',
      eventType: episodeType(classification.intent),
      conversationId,
      sourceMessageId,
      summary: episodeSummary(query, classification, companies),
      entities,
      content: {
        actor: 'user',
        assertionType: 'research_request',
        intent: classification.intent,
        companies,
        sector: classification.sector ?? context.activeSector ?? null,
        horizon: context.investorProfile?.horizon ?? null,
        analysisTimestamp: new Date().toISOString(),
        marketDataSource: context.lastDecision ? 'Upstox' : null,
        ownershipConfirmed: Boolean(context.investorProfile?.ownsStock),
      },
      confidence: classification.confidence,
      importance: classification.intent === 'investment_decision' ? 0.85 : 0.65,
      expiresAt: daysFromNow(365),
    });
  }

  for (const company of companies) {
    const report = context.reports?.[company.ticker];
    if (!report) continue;
    const facts = [
      ['Revenue', report.financials.revenue], ['Net profit', report.financials.profit],
      ['ROE', report.profitability.roe], ['ROCE', report.profitability.roce],
      ['Debt/equity', report.financials.debtToEquity], ['P/E', report.valuation.pe],
    ].flatMap(([label, metric]) => typeof label === 'string' && metric && typeof metric === 'object' && metric.value != null ? [{
      metric: label,
      value: metric.value,
      unit: metric.unit,
      period: metric.period ?? null,
      basis: metric.basis ?? 'Unspecified',
      sourceUrl: metric.sourceUrl ?? null,
      retrievalTimestamp: metric.retrievedAt ?? report.generatedAt,
      verificationStatus: metric.verificationStatus ?? 'unverified',
    }] : []);
    candidates.push({
      type: 'semantic',
      eventType: 'verified_company_research',
      conversationId,
      sourceMessageId,
      summary: `${company.name} research facts from the report generated ${new Date(report.generatedAt).toLocaleDateString('en-IN')}.`,
      entities: [company.ticker, company.name],
      content: { company, reportGeneratedAt: report.generatedAt, facts },
      confidence: report.dataQuality?.overallConfidence === 'High' ? 0.9 : report.dataQuality?.overallConfidence === 'Moderate' ? 0.72 : 0.5,
      importance: 0.72,
      expiresAt: daysFromNow(90),
    });
  }

  if (explicitSaveRequested(query)) {
    const lower = query.toLowerCase();
    const type = /jaro ai|project|module|architecture|deployment|bug|implementation/.test(lower) ? 'project'
      : /format|report style|table|chart|citation|reference|structure|explain/.test(lower) ? 'procedural'
        : 'profile';
    candidates.push({
      type,
      eventType: type === 'project' ? 'project_decision' : type === 'procedural' ? 'workflow_preference' : 'user_confirmed_preference',
      conversationId,
      sourceMessageId,
      summary: stripMemoryCommand(query),
      entities,
      content: { explicitlySaved: true, originalStatement: query.slice(0, 2_000) },
      confidence: 1,
      importance: 0.9,
    });
  }

  return candidates;
}

export function applyMemoryHints(context: ConversationContext, memories: RetrievedMemory[]): ConversationContext {
  if (context.activeCompanies.length) return { ...context, retrievedMemories: memories };
  const companyMemory = memories.find((memory) => {
    const companies = memory.content?.companies;
    return Array.isArray(companies) && companies.length > 0;
  });
  const companies = companyMemory?.content?.companies;
  const validCompanies = Array.isArray(companies) ? companies.filter(isCompanyIdentity).slice(0, 4) : [];
  return {
    ...context,
    activeCompanies: validCompanies,
    activeSector: context.activeSector ?? (typeof companyMemory?.content?.activeSector === 'string' ? companyMemory.content.activeSector : null),
    retrievedMemories: memories,
  };
}

export function formatMemoryContext(memories: RetrievedMemory[]) {
  if (!memories.length) return '';
  return memories.slice(0, 8).map((memory, index) => {
    const metadata = `${memory.type}; confidence ${memory.confidence.toFixed(2)}; updated ${memory.updatedAt}; relevance ${memory.relevance.toFixed(2)}`;
    return `[Memory ${index + 1} — ${metadata}] ${memory.summary}`;
  }).join('\n');
}

function workingSummary(classification: QueryClassification | undefined, companies: CompanyIdentity[], context: ConversationContext) {
  const entities = companies.length ? companies.map((company) => `${company.exchange}:${company.ticker}`).join(', ') : context.activeSector ?? 'general research';
  return `Active ${classification?.intent ?? context.lastIntent ?? 'research'} context for ${entities}.`;
}
function shouldCreateEpisode(intent: QueryClassification['intent']) { return ['company_research', 'stock_comparison', 'investment_decision', 'technical_analysis', 'investment_planning', 'portfolio_analysis', 'financial_education'].includes(intent); }
function episodeType(intent: QueryClassification['intent']) { return intent === 'investment_decision' ? 'decision_analysis_requested' : intent === 'stock_comparison' ? 'company_comparison_requested' : `${intent}_requested`; }
function episodeSummary(query: string, classification: QueryClassification, companies: CompanyIdentity[]) {
  const subjects = companies.length ? companies.map((company) => company.ticker).join(', ') : classification.sector ?? 'the requested topic';
  return `User requested ${classification.intent.replaceAll('_', ' ')} for ${subjects}: ${query.slice(0, 280)}`;
}
function explicitSaveRequested(query: string) { return /\b(remember (?:that|this|my)|save (?:this|my preference|this preference)|from now on,? (?:please )?|i prefer (?:reports?|answers?|charts?|citations?))\b/i.test(query); }
function stripMemoryCommand(query: string) { return query.replace(/^.*?\b(?:remember (?:that|this)|save (?:this|my preference)|from now on,?|i prefer)\b\s*/i, '').trim().slice(0, 1_200) || query.slice(0, 1_200); }
function daysFromNow(days: number) { return new Date(Date.now() + days * 86_400_000); }
function isCompanyIdentity(value: unknown): value is CompanyIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === 'string' && typeof item.ticker === 'string' && typeof item.exchange === 'string' && typeof item.country === 'string';
}
