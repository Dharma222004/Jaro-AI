// lib/memory/context-assembly.ts
// Assemble the final context packet for LLM requests

import type { ConversationContext } from '@/types/conversation';
import type { RetrievedMemory } from '@/types/memory';
import type { RetrievalContext } from './orchestrator';
import { formatRetrievalContext } from './orchestrator';

export interface AssembledContext {
  systemAddendum: string;  // Extra context to prepend to system prompt
  conversationSummary: string;
  memoryContext: string;
  documentContext: string;
  diagnostics: string;
}

export function assembleContext(params: {
  query: string;
  conversationContext: ConversationContext;
  retrievalResult: RetrievalContext;
  conversationSummary?: string;
}): AssembledContext {
  const { retrievalResult, conversationSummary } = params;
  
  // Format memory context
  const memoryContext = formatRetrievalContext(retrievalResult, 1500);
  
  // Format document context separately
  const docContext = retrievalResult.documentChunks.length > 0
    ? retrievalResult.documentChunks.slice(0, 5).map(c => {
        const ref = [c.documentTitle, c.sectionTitle, c.pageNumber ? `p.${c.pageNumber}` : null].filter(Boolean).join(' › ');
        return `[${ref}]\n${c.content}`;
      }).join('\n\n')
    : '';

  // Build system addendum for LLM
  const addendumParts: string[] = [];
  
  if (params.conversationContext.activeCompanies.length > 0) {
    const companies = params.conversationContext.activeCompanies.map(c => `${c.name} (${c.exchange}:${c.ticker})`).join(', ');
    addendumParts.push(`Active companies in this conversation: ${companies}`);
  }
  
  if (memoryContext) {
    addendumParts.push(`\n## Retrieved Memory Context\n${memoryContext}`);
  }
  
  if (docContext) {
    addendumParts.push(`\n## Retrieved Document Evidence\nUse this document evidence to answer the user's question. Always cite the document title and page number.\n${docContext}`);
  }

  // Diagnostics for developer inspection
  const diag = `[Memory retrieval: ${retrievalResult.diagnostics.durationMs}ms, working=${retrievalResult.diagnostics.workingMemoryCount}, episodic=${retrievalResult.diagnostics.episodicCount}, ltm=${retrievalResult.diagnostics.longTermCount}, docs=${retrievalResult.diagnostics.documentChunkCount}${retrievalResult.diagnostics.errors.length ? ', errors=' + retrievalResult.diagnostics.errors.join(';') : ''}]`;

  return {
    systemAddendum: addendumParts.join('\n'),
    conversationSummary: conversationSummary ?? '',
    memoryContext,
    documentContext: docContext,
    diagnostics: diag,
  };
}
