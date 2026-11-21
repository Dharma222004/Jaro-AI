// lib/memory/extraction.ts
// Extract and store meaningful memories after each AI response (non-blocking)

import { buildMemoryCandidates } from './policy';
import { createOrUpdateMemory } from './store';
import { createEpisode } from './episodic-store';
import { upsertLongTermMemory } from './long-term-store';
import type { ConversationContext } from '@/types/conversation';
import type { QueryClassification } from '@/types/conversation';

export interface ExtractionParams {
  identity: string;
  query: string;
  response: string;
  conversationId: string;
  sourceMessageId?: string;
  classification?: QueryClassification;
  context: ConversationContext;
}

export async function extractAndStoreMemories(params: ExtractionParams): Promise<void> {
  const { identity, query, conversationId, sourceMessageId, classification, context } = params;
  
  try {
    // 1. Build and store working/episodic/semantic candidates (existing logic)
    const candidates = buildMemoryCandidates({ query, conversationId, sourceMessageId, classification, context });
    await Promise.allSettled(candidates.map(c => createOrUpdateMemory(identity, c)));

    // 2. Create rich episodic event for meaningful intents
    if (classification && shouldCreateRichEpisode(classification.intent)) {
      const companies = context.activeCompanies.slice(0, 4);
      const entities = companies.map(c => c.ticker);
      await createEpisode(identity, {
        conversationId,
        eventType: mapIntentToEventType(classification.intent),
        title: generateEpisodeTitle(query, companies),
        summary: generateEpisodeSummary(query, params.response, companies, classification),
        entities,
        sourceMessageId,
        outcome: 'success',
        importance: classification.intent === 'investment_decision' ? 0.9 : 0.65,
        confidence: classification.confidence,
        metadata: {
          intent: classification.intent,
          sector: classification.sector,
          horizon: context.investorProfile?.horizon,
          queryTimestamp: new Date().toISOString(),
        },
      }).catch(() => {}); // Non-fatal
    }

    // 3. Extract explicit preference/project memories
    if (hasExplicitSaveIntent(query)) {
      await extractExplicitMemory(identity, query, context, conversationId).catch(() => {});
    }
    
  } catch (err) {
    console.warn('[memory/extraction] Non-fatal extraction error:', err instanceof Error ? err.message : err);
  }
}

async function extractExplicitMemory(identity: string, query: string, context: ConversationContext, conversationId: string): Promise<void> {
  const lower = query.toLowerCase();
  const isProject = /jaro ai|project|architecture|implementation|deployment|bug|module|feature/.test(lower);
  const isProcedural = /format|report style|citation|table|structure|how to|workflow/.test(lower);
  const category = isProject ? 'project' : isProcedural ? 'procedural' : 'preference';
  
  const value = stripSaveCommand(query);
  if (!value || value.length < 10) return;
  
  await upsertLongTermMemory(identity, {
    category,
    title: value.slice(0, 100),
    value: value.slice(0, 2000),
    sourceType: 'user_explicit',
    sourceRef: conversationId,
    confidence: 1.0,
    importance: 0.9,
  });
}

function shouldCreateRichEpisode(intent: string): boolean {
  return ['company_research', 'investment_decision', 'stock_comparison', 'technical_analysis', 'portfolio_analysis', 'financial_education'].includes(intent);
}

function mapIntentToEventType(intent: string): 'company_research' | 'investment_decision' | 'document_analysis' | 'user_preference' | 'project_decision' | 'tool_execution' | 'stock_comparison' | 'portfolio_analysis' | 'error' | 'task_completion' {
  const map: Record<string, 'company_research' | 'investment_decision' | 'document_analysis' | 'user_preference' | 'project_decision' | 'tool_execution' | 'stock_comparison' | 'portfolio_analysis' | 'error' | 'task_completion'> = {
    'company_research': 'company_research',
    'investment_decision': 'investment_decision',
    'stock_comparison': 'stock_comparison',
    'technical_analysis': 'company_research',
    'portfolio_analysis': 'portfolio_analysis',
  };
  return map[intent] ?? 'company_research';
}

function generateEpisodeTitle(query: string, companies: Array<{ ticker: string; name: string }>): string {
  if (companies.length === 0) return query.slice(0, 100);
  if (companies.length === 1) return `Research: ${companies[0].name} (${companies[0].ticker})`;
  return `Comparison: ${companies.map(c => c.ticker).join(' vs ')}`;
}

function generateEpisodeSummary(query: string, response: string, companies: Array<{ ticker: string }>, classification: QueryClassification): string {
  const tickers = companies.map(c => c.ticker).join(', ');
  const intentLabel = classification.intent.replace(/_/g, ' ');
  return `User requested ${intentLabel}${tickers ? ` for ${tickers}` : ''}. Query: "${query.slice(0, 200)}". Response provided covering ${intentLabel} analysis.`;
}

function hasExplicitSaveIntent(query: string): boolean {
  return /\b(remember (?:that|this|my)|save (?:this|my preference)|from now on|i prefer (?:reports?|answers?|format))\b/i.test(query);
}

function stripSaveCommand(query: string): string {
  return query.replace(/^.*?\b(?:remember (?:that|this)|save (?:this|my preference)|from now on[,]?|i prefer)\b\s*/i, '').trim();
}
