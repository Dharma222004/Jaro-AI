import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from '@/lib/memory/identity';
import type { MemoryType } from '@/types/memory';

/**
 * Enhanced retrieval over memory records and shadow journal signals.
 * Combines lexical overlap, entity matching, recency, and importance scoring
 * to surface the most relevant prior context — a lightweight NeMo Retriever
 * equivalent without external vector dependencies.
 */
export interface SearchMemoryParams {
  identity: string;
  query: string;
  types?: MemoryType[];
  limit?: number;
  includeJournal?: boolean;
}

export interface SearchResult {
  id: string;
  source: 'memory' | 'journal';
  type: string;
  title: string;
  summary: string;
  relevance: number;
  recency: number;
  importance: number;
  createdAt: string;
  updatedAt: string;
  entities: string[];
  metadata?: Record<string, unknown>;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((t) => b.has(t)).length;
  return intersection / Math.min(a.size, b.size);
}

function recencyScore(updatedAt: string): number {
  const ageDays = Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  return Math.round(Math.exp(-ageDays / 30) * 100) / 100;
}

export async function searchMemoryAndJournal(params: SearchMemoryParams): Promise<SearchResult[]> {
  const { identity, query, types, limit = 10, includeJournal = false } = params;
  const ownerKey = memoryOwnerKey(identity);
  const now = new Date();
  const queryTokens = tokenize(query);

  // Expire stale memories
  await prisma.memoryRecord.updateMany({
    where: { ownerKey, active: true, expiresAt: { lte: now } },
    data: { active: false },
  });

  // Fetch memories
  const memoryRecords = await prisma.memoryRecord.findMany({
    where: {
      ownerKey,
      active: true,
      ...(types?.length ? { type: { in: types } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
  });

  const results: SearchResult[] = [];

  for (const record of memoryRecords) {
    const summary = record.summary ?? '';
    const entities = Array.isArray(record.entitiesJson) ? record.entitiesJson : (JSON.parse(record.entitiesJson ?? '[]') as string[]);
    const summaryTokens = tokenize(`${summary} ${entities.join(' ')}`);
    const lexical = overlap(queryTokens, summaryTokens);
    const entityMatches = entities.filter((e: string) => queryTokens.has(e.toLowerCase())).length;
    const entityScore = queryTokens.size ? entityMatches / queryTokens.size : 0;
    const recency = recencyScore(record.updatedAt.toISOString());
    const relevance = Math.min(1, lexical * 0.45 + entityScore * 0.35 + recency * 0.1 + record.importance * 0.1);

    if (relevance >= 0.15 || record.type === 'working') {
      results.push({
        id: record.id,
        source: 'memory',
        type: record.type,
        title: summary.slice(0, 80),
        summary,
        relevance,
        recency,
        importance: record.importance,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        entities: entities as string[],
        metadata: record.contentJson ? JSON.parse(record.contentJson) : undefined,
      });
    }
  }

  // Fetch journal signals if requested
  if (includeJournal) {
    const journalRecords = await prisma.strategySignal.findMany({
      where: { ownerKey },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    for (const signal of journalRecords) {
      const setup = JSON.parse(signal.setupJson ?? '{}') as {
        ticker?: string;
        strategyId?: string;
        status?: string;
        entry?: { zoneLow?: number; zoneHigh?: number; triggerPrice?: number };
        stop?: { price?: number };
      };
      const searchableText = `${setup.ticker ?? ''} ${setup.strategyId ?? ''} ${setup.status ?? ''}`;
      const searchTokens = tokenize(searchableText);
      const lexical = overlap(queryTokens, searchTokens);
      const recency = recencyScore(signal.updatedAt.toISOString());
      const relevance = Math.min(1, lexical * 0.6 + recency * 0.3 + 0.1);

      if (relevance >= 0.15) {
        results.push({
          id: signal.id,
          source: 'journal',
          type: setup.strategyId ?? 'shadow_signal',
          title: `${setup.ticker ?? 'Signal'} — ${setup.strategyId ?? 'shadow'}`,
          summary: `${setup.status ?? 'shadow signal'} for ${setup.ticker ?? 'instrument'}`,
          relevance,
          recency,
          importance: 0.7,
          createdAt: signal.createdAt.toISOString(),
          updatedAt: signal.updatedAt.toISOString(),
          entities: [setup.ticker ?? ''].filter(Boolean),
          metadata: {
            decisionStatus: signal.decisionStatus,
            mode: signal.mode,
            outcomeStatus: signal.outcomeStatus,
            entry: setup.entry,
            stop: setup.stop,
          },
        });
      }
    }
  }

  // Update last accessed for returned memories
  const memoryIds = results.filter((r) => r.source === 'memory').map((r) => r.id);
  if (memoryIds.length) {
    await prisma.memoryRecord.updateMany({
      where: { ownerKey, id: { in: memoryIds } },
      data: { lastAccessedAt: now },
    });
  }

  return results
    .sort((a, b) => b.relevance - a.relevance || b.importance - a.importance)
    .slice(0, limit);
}
