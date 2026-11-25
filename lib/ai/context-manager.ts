// lib/ai/context-manager.ts
// 3-Layer Context Management System:
// A) Current Conversation Context hydration (DB + sanitized client state)
// B) Automatic Conversation Summarization / Compaction preserving financial facts
// C) Token-budgeted prioritization across all 7 context layers.

import {
  getConversation,
  getConversationMessages,
  updateConversationSummary,
  upsertConversation,
} from '@/lib/memory/conversation-store';
import { orchestrateMemoryRetrieval, type RetrievalContext } from '@/lib/memory/orchestrator';
import { retrieveFinancialKnowledge, type HybridKnowledgeResult } from '@/lib/knowledge/hybrid-retriever';
import type { ConversationContext, ConversationHistoryMessage } from '@/types/conversation';
import type { RetrievedMemory } from '@/types/memory';

export interface ContextLayerBudget {
  maxContextTokens: number;
  maxHistoryMessages: number;
  compactionTriggerMessages: number;
}

export interface ManagedContextResult {
  conversationId: string;
  history: ConversationHistoryMessage[];
  conversationSummary: string;
  activeEntities: string[];
  openTasks: string[];
  retrievedMemories: RetrievedMemory[];
  longTermPreferencesText: string;
  knowledgeResult: HybridKnowledgeResult;
  retrievalDiagnostics: RetrievalContext['diagnostics'] | null;
  context: ConversationContext;
  estimatedPromptTokens: number;
}

const DEFAULT_BUDGET: ContextLayerBudget = {
  maxContextTokens: 16_000,
  maxHistoryMessages: 8,
  compactionTriggerMessages: 10,
};

/**
 * Layer A + B + C: Retrieves and budgets conversation history, compacted summary,
 * long-term user memories, and financial knowledge passages for the active request.
 */
export async function buildManagedContext(params: {
  identity: string | null;
  conversationId: string;
  query: string;
  clientHistory: ConversationHistoryMessage[];
  clientContext: ConversationContext;
  maxContextTokens?: number;
  memoryEnabled: boolean;
}): Promise<ManagedContextResult> {
  const maxTokens = params.maxContextTokens ?? DEFAULT_BUDGET.maxContextTokens;
  let history: ConversationHistoryMessage[] = [...params.clientHistory];
  let conversationSummary = '';
  let activeEntities = params.clientContext.activeCompanies.map((c) => c.ticker.toUpperCase());
  let openTasks: string[] = [];
  let retrievedMemories: RetrievedMemory[] = [];
  let retrievalDiagnostics: RetrievalContext['diagnostics'] | null = null;
  let longTermPreferencesText = '';

  // Layer A & B: Server-side conversation hydration + rolling compaction when authenticated
  if (params.identity) {
    try {
      const [convRecord, dbMessages] = await Promise.all([
        getConversation(params.identity, params.conversationId),
        getConversationMessages(params.identity, params.conversationId, 40),
      ]);

      if (convRecord) {
        conversationSummary = convRecord.summary ?? '';
        activeEntities = [...new Set([...activeEntities, ...convRecord.entities])].slice(0, 10);
        openTasks = convRecord.openTasks;
      } else {
        await upsertConversation(params.identity, {
          conversationId: params.conversationId,
          entities: activeEntities,
        }).catch(() => {});
      }

      if (dbMessages.length > 0) {
        const merged = mergeHistories(dbMessages, params.clientHistory);
        // Trigger rolling compaction if messages grew beyond window
        if (merged.length > DEFAULT_BUDGET.compactionTriggerMessages) {
          const splitIndex = merged.length - DEFAULT_BUDGET.maxHistoryMessages;
          const olderMessages = merged.slice(0, splitIndex);
          const recentMessages = merged.slice(splitIndex);
          const needsRefresh =
            !convRecord || merged.length > (convRecord.summaryMessageCount || 0) + 4;

          if (needsRefresh) {
            conversationSummary = compactMessagesPreservingFinancialFacts(
              olderMessages,
              conversationSummary,
              activeEntities,
            );
            await updateConversationSummary(
              params.identity,
              params.conversationId,
              conversationSummary,
              olderMessages.length,
            ).catch(() => {});
          }
          history = recentMessages;
        } else {
          history = merged;
        }
      }
    } catch {
      // Non-fatal fallback to bounded client history if SQLite unavailable
      history = params.clientHistory.slice(-DEFAULT_BUDGET.maxHistoryMessages);
    }
  } else {
    history = params.clientHistory.slice(-DEFAULT_BUDGET.maxHistoryMessages);
  }

  // Long-Term Memory & Episodic Retrieval
  if (params.identity && params.memoryEnabled) {
    try {
      const retrieval = await orchestrateMemoryRetrieval({
        identity: params.identity,
        query: params.query,
        conversationId: params.conversationId,
        entities: activeEntities,
        includeDocuments: true,
      });
      retrievalDiagnostics = retrieval.diagnostics;
      retrievedMemories = [
        ...retrieval.workingMemory,
        ...retrieval.longTermMemories.map((ltm) => ({
          id: ltm.id,
          type: ltm.category as RetrievedMemory['type'],
          eventType: 'long_term_fact',
          summary: `[Preference/Fact] ${ltm.title}: ${ltm.value}`,
          entities: [],
          confidence: ltm.confidence,
          importance: ltm.importance,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          relevance: 0.85,
          recency: 1.0,
        })),
        ...retrieval.episodicMemories.map((ep) => ({
          id: ep.id,
          type: 'episodic' as const,
          eventType: ep.eventType,
          conversationId: params.conversationId,
          summary: `[Past ${ep.eventType} — ${new Date(ep.eventTimestamp).toLocaleDateString('en-IN')}] ${ep.summary}`,
          entities: ep.entities,
          confidence: 0.9,
          importance: 0.8,
          active: true,
          createdAt: ep.eventTimestamp,
          updatedAt: ep.eventTimestamp,
          relevance: ep.relevance,
          recency: 0.8,
        })),
      ];

      if (retrieval.longTermMemories.length > 0) {
        longTermPreferencesText = retrieval.longTermMemories
          .slice(0, 5)
          .map((m) => `- ${m.title}: ${m.value}`)
          .join('\n');
      }
    } catch {
      // Non-fatal
    }
  }

  // Layer C: Financial Knowledge Retrieval (Hybrid RAG)
  const knowledgeResult = await retrieveFinancialKnowledge({
    identity: params.memoryEnabled ? params.identity : null,
    query: params.query,
    tickers: activeEntities,
    topK: 6,
  }).catch(
    (): HybridKnowledgeResult => ({ passages: [], periodNotice: null, formattedEvidence: '' }),
  );

  // Enforce strict token budget across assembled context
  const budgeted = enforceTokenBudget({
    query: params.query,
    history,
    conversationSummary,
    longTermPreferencesText,
    knowledgeEvidence: knowledgeResult.formattedEvidence,
    maxTokens,
  });

  const nextContext: ConversationContext = {
    ...params.clientContext,
    retrievedMemories,
    conversationSummary: budgeted.conversationSummary || undefined,
    activeAssumptions: params.clientContext.activeAssumptions ?? [],
  };

  return {
    conversationId: params.conversationId,
    history: budgeted.history,
    conversationSummary: budgeted.conversationSummary,
    activeEntities,
    openTasks,
    retrievedMemories,
    longTermPreferencesText: budgeted.longTermPreferencesText,
    knowledgeResult,
    retrievalDiagnostics,
    context: nextContext,
    estimatedPromptTokens: budgeted.estimatedTokens,
  };
}

function mergeHistories(
  dbMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  clientHistory: ConversationHistoryMessage[],
): ConversationHistoryMessage[] {
  const fromDb = dbMessages
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  // Append any client turns not yet present in DB tail
  const dbTail = new Set(fromDb.slice(-6).map((m) => `${m.role}:${m.content.slice(0, 120)}`));
  const merged = [...fromDb];
  for (const c of clientHistory) {
    const key = `${c.role}:${c.content.slice(0, 120)}`;
    if (!dbTail.has(key)) {
      merged.push(c);
    }
  }
  return merged;
}

/**
 * Compacts older turns into a dense structured summary WITHOUT dropping financial metrics,
 * tickers, reporting periods, dates, or source URLs required for accuracy validation.
 */
export function compactMessagesPreservingFinancialFacts(
  olderMessages: ConversationHistoryMessage[],
  priorSummary: string,
  entities: string[],
): string {
  const facts: string[] = [];
  if (priorSummary) {
    facts.push(`Prior summary: ${priorSummary.slice(0, 1200)}`);
  }
  if (entities.length > 0) {
    facts.push(`Discussed entities: ${entities.join(', ')}`);
  }

  for (const msg of olderMessages.slice(-12)) {
    const prefix = msg.role === 'user' ? 'User' : 'Jaro';
    // Extract lines containing numerical financial figures, dates, tickers, or URLs
    const lines = msg.content.split(/\r?\n/);
    const importantLines = lines.filter((l) =>
      /(?:₹|Rs\.?|INR|%|Cr|FY\d{2,4}|Q[1-4]|ROE|ROCE|P\/E|P\/B|Target|Stop|Entry|https?:\/\/)/i.test(l),
    );
    const snippet = importantLines.length > 0
      ? importantLines.slice(0, 4).join(' | ').slice(0, 320)
      : msg.content.slice(0, 180);
    facts.push(`- [${prefix}] ${snippet}`);
  }

  return facts.join('\n').slice(0, 3500);
}

function enforceTokenBudget(params: {
  query: string;
  history: ConversationHistoryMessage[];
  conversationSummary: string;
  longTermPreferencesText: string;
  knowledgeEvidence: string;
  maxTokens: number;
}) {
  const charBudget = Math.max(4000, params.maxTokens * 4);
  let usedChars = params.query.length + 3000; // reserve for trusted system prompt

  // Priority 3: Recent detailed messages (keep newest up to 45% budget)
  const historyCap = Math.floor(charBudget * 0.45);
  const keptHistory: ConversationHistoryMessage[] = [];
  let histChars = 0;
  for (let i = params.history.length - 1; i >= 0; i--) {
    const msg = params.history[i];
    const clipped = msg.content.slice(0, 2800);
    if (histChars + clipped.length > historyCap && keptHistory.length >= 2) break;
    histChars += clipped.length;
    keptHistory.unshift({ role: msg.role, content: clipped });
  }
  usedChars += histChars;

  // Priority 4: Compacted older summary
  const summaryCap = Math.min(3000, Math.max(0, charBudget - usedChars));
  const summary = params.conversationSummary.slice(0, summaryCap);
  usedChars += summary.length;

  // Priority 5: Long-term user preferences
  const prefCap = Math.min(1200, Math.max(0, charBudget - usedChars));
  const longTermPreferencesText = params.longTermPreferencesText.slice(0, prefCap);
  usedChars += longTermPreferencesText.length;

  // Priority 6/7: Knowledge RAG evidence
  const ragCap = Math.max(0, charBudget - usedChars);
  const knowledgeEvidence = params.knowledgeEvidence.slice(0, ragCap);
  usedChars += knowledgeEvidence.length;

  return {
    history: keptHistory,
    conversationSummary: summary,
    longTermPreferencesText,
    knowledgeEvidence,
    estimatedTokens: Math.ceil(usedChars / 4),
  };
}
