// lib/memory/orchestrator.ts
// Unified memory retrieval orchestrator — retrieves the RIGHT context for each request

import { retrieveMemories } from './store';
import { searchEpisodes } from './episodic-store';
import { retrieveLongTermMemories } from './long-term-store';
import { hybridSearchChunks } from '@/lib/documents/store';
import type { RetrievedMemory } from '@/types/memory';

export interface RetrievalContext {
  workingMemory: RetrievedMemory[];
  episodicMemories: EpisodicSummary[];
  longTermMemories: LTMSummary[];
  documentChunks: DocumentChunkSummary[];
  diagnostics: RetrievalDiagnostics;
}

export interface EpisodicSummary {
  id: string;
  eventType: string;
  title: string;
  summary: string;
  entities: string[];
  eventTimestamp: string;
  relevance: number;
}

export interface LTMSummary {
  id: string;
  category: string;
  title: string;
  value: string;
  confidence: number;
  importance: number;
}

export interface DocumentChunkSummary {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  contentType: string;
  pageNumber?: number | null;
  sectionTitle?: string | null;
  score: number;
}

export interface RetrievalDiagnostics {
  durationMs: number;
  workingMemoryCount: number;
  episodicCount: number;
  longTermCount: number;
  documentChunkCount: number;
  errors: string[];
}

export interface OrchestratorParams {
  identity: string;
  query: string;
  conversationId?: string;
  entities?: string[];
  includeDocuments?: boolean;
  documentIds?: string[];
  companyId?: string;
}

export async function orchestrateMemoryRetrieval(params: OrchestratorParams): Promise<RetrievalContext> {
  const start = Date.now();
  const errors: string[] = [];

  // Run all retrievals in parallel
  const [workingResult, episodicResult, ltmResult, docResult] = await Promise.allSettled([
    // Working/conversational memory
    retrieveMemories(params.identity, {
      query: params.query,
      conversationId: params.conversationId,
      entities: params.entities,
      types: ['working', 'episodic', 'semantic', 'procedural', 'profile', 'project'],
      limit: 10,
    }),
    // Episodic events
    searchEpisodes(params.identity, {
      query: params.query,
      entities: params.entities,
      limit: 5,
    }),
    // Long-term structured memories
    retrieveLongTermMemories(params.identity, {
      query: params.query,
      limit: 6,
    }),
    // Document chunks (only if documents are relevant)
    params.includeDocuments !== false ? hybridSearchChunks(params.identity, {
      query: params.query,
      documentIds: params.documentIds,
      companyId: params.companyId,
      topK: 5,
    }) : Promise.resolve([]),
  ]);

  const workingMemory = workingResult.status === 'fulfilled' ? workingResult.value : [];
  if (workingResult.status === 'rejected') errors.push(`Working memory: ${workingResult.reason}`);

  const rawEpisodic = episodicResult.status === 'fulfilled' ? episodicResult.value : [];
  if (episodicResult.status === 'rejected') errors.push(`Episodic: ${episodicResult.reason}`);

  const rawLTM = ltmResult.status === 'fulfilled' ? ltmResult.value : [];
  if (ltmResult.status === 'rejected') errors.push(`Long-term: ${ltmResult.reason}`);

  const rawDocs = docResult.status === 'fulfilled' ? docResult.value : [];
  if (docResult.status === 'rejected') errors.push(`Documents: ${docResult.reason}`);

  const durationMs = Date.now() - start;
  const tokenEstimate = Math.round(
    (workingMemory.reduce((acc, m) => acc + m.summary.length, 0) +
     rawEpisodic.reduce((acc, e) => acc + e.summary.length, 0) +
     rawLTM.reduce((acc, l) => acc + l.value.length, 0) +
     rawDocs.reduce((acc, d) => acc + d.content.length, 0)) / 4
  );

  // Asynchronous diagnostic logging to database
  try {
    const { prisma } = await import('@/lib/database/client');
    const { memoryOwnerKey } = await import('./identity');
    const ownerKey = memoryOwnerKey(params.identity);
    void prisma.memoryRetrievalLog.create({
      data: {
        ownerKey,
        conversationId: params.conversationId,
        query: params.query.slice(0, 500),
        episodicCount: rawEpisodic.length,
        longTermCount: rawLTM.length,
        documentCount: rawDocs.length,
        selectedSourceIds: JSON.stringify(rawDocs.map(d => d.documentId)),
        retrievalMs: durationMs,
        contextTokenEstimate: tokenEstimate,
        errors: JSON.stringify(errors),
      },
    }).catch(() => {});
  } catch {}

  return {
    workingMemory,
    episodicMemories: rawEpisodic.map(e => ({
      id: e.id,
      eventType: e.eventType,
      title: e.title,
      summary: e.summary,
      entities: e.entities,
      eventTimestamp: e.eventTimestamp,
      relevance: 0.7, // placeholder — search already ranked
    })),
    longTermMemories: rawLTM.map(m => ({
      id: m.id, category: m.category, title: m.title,
      value: m.value, confidence: m.confidence, importance: m.importance,
    })),
    documentChunks: rawDocs.map(c => ({
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      chunkIndex: c.chunkIndex,
      content: c.content,
      contentType: c.contentType,
      pageNumber: c.pageNumber,
      sectionTitle: c.sectionTitle,
      score: c.score,
    })),
    diagnostics: {
      durationMs,
      workingMemoryCount: workingMemory.length,
      episodicCount: rawEpisodic.length,
      longTermCount: rawLTM.length,
      documentChunkCount: rawDocs.length,
      errors,
    },
  };
}

export function formatRetrievalContext(ctx: RetrievalContext, maxTokens = 2000): string {
  const parts: string[] = [];
  let chars = 0;
  const budget = maxTokens * 4; // approx 4 chars per token

  // Working memory (highest priority)
  for (const mem of ctx.workingMemory) {
    if (mem.type === 'working' || mem.importance > 0.7) {
      const line = `[Memory — ${mem.type}] ${mem.summary}`;
      if (chars + line.length > budget * 0.4) break;
      parts.push(line);
      chars += line.length;
    }
  }

  // Long-term memories (preferences, procedures, project)
  if (ctx.longTermMemories.length && chars < budget * 0.6) {
    parts.push('--- Established Knowledge ---');
    for (const ltm of ctx.longTermMemories) {
      const line = `[${ltm.category}] ${ltm.title}: ${ltm.value}`;
      if (chars + line.length > budget * 0.6) break;
      parts.push(line);
      chars += line.length;
    }
  }

  // Episodic memories
  if (ctx.episodicMemories.length && chars < budget * 0.75) {
    parts.push('--- Previous Research ---');
    for (const ep of ctx.episodicMemories.slice(0, 3)) {
      const line = `[${ep.eventType} — ${new Date(ep.eventTimestamp).toLocaleDateString('en-IN')}] ${ep.summary}`;
      if (chars + line.length > budget * 0.75) break;
      parts.push(line);
      chars += line.length;
    }
  }

  // Document chunks
  if (ctx.documentChunks.length && chars < budget) {
    parts.push('--- Document Evidence ---');
    for (const chunk of ctx.documentChunks.slice(0, 4)) {
      const citation = chunk.pageNumber ? ` (p.${chunk.pageNumber})` : '';
      const line = `[Doc: ${chunk.documentTitle}${citation}] ${chunk.content.slice(0, 400)}`;
      if (chars + line.length > budget) break;
      parts.push(line);
      chars += line.length;
    }
  }

  return parts.join('\n');
}
