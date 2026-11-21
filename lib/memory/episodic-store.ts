// lib/memory/episodic-store.ts
// Production episodic memory engine
// Stores meaningful interaction events, searchable across conversations

import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from './identity';

export interface EpisodicEventData {
  id: string;
  conversationId?: string | null;
  eventType: string;
  title: string;
  summary: string;
  entities: string[];
  documentIds: string[];
  sourceMessageId?: string | null;
  outcome?: string | null;
  importance: number;
  confidence: number;
  metadata: Record<string, unknown>;
  eventTimestamp: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEpisodeParams {
  conversationId?: string;
  eventType: 'company_research' | 'investment_decision' | 'document_analysis' | 'user_preference' | 'project_decision' | 'tool_execution' | 'stock_comparison' | 'portfolio_analysis' | 'error' | 'task_completion';
  title: string;
  summary: string;
  entities?: string[];
  documentIds?: string[];
  sourceMessageId?: string;
  outcome?: 'success' | 'failure' | 'partial' | 'pending';
  importance?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export async function createEpisode(identity: string, params: CreateEpisodeParams): Promise<EpisodicEventData> {
  const ownerKey = memoryOwnerKey(identity);
  const entities = normalizeEntities(params.entities ?? []);
  const summary = params.summary.trim().slice(0, 2000);
  const title = params.title.trim().slice(0, 300);
  
  // Check for duplicate episode in same conversation within 5 minutes
  if (params.conversationId) {
    const recent = await prisma.episodicEvent.findFirst({
      where: {
        ownerKey,
        conversationId: params.conversationId,
        eventType: params.eventType,
        eventTimestamp: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
    });
    if (recent && similar(recent.summary, summary)) {
      return toEpisodicData(recent);
    }
  }

  const record = await prisma.episodicEvent.create({
    data: {
      ownerKey,
      conversationId: params.conversationId,
      eventType: params.eventType,
      title,
      summary,
      entitiesJson: JSON.stringify(entities),
      documentIds: JSON.stringify(params.documentIds ?? []),
      sourceMessageId: params.sourceMessageId,
      outcome: params.outcome,
      importance: clamp(params.importance ?? 0.6),
      confidence: clamp(params.confidence ?? 0.8),
      metadataJson: JSON.stringify(params.metadata ?? {}),
    },
  });
  return toEpisodicData(record);
}

export async function searchEpisodes(identity: string, params: {
  query: string;
  entities?: string[];
  eventTypes?: string[];
  conversationId?: string;
  since?: Date;
  limit?: number;
}): Promise<EpisodicEventData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const limit = Math.min(params.limit ?? 10, 30);
  
  const records = await prisma.episodicEvent.findMany({
    where: {
      ownerKey,
      ...(params.eventTypes?.length ? { eventType: { in: params.eventTypes } } : {}),
      ...(params.since ? { eventTimestamp: { gte: params.since } } : {}),
    },
    orderBy: [{ importance: 'desc' }, { eventTimestamp: 'desc' }],
    take: 100,
  });

  const queryTokens = tokenize(params.query);
  const requestedEntities = new Set(normalizeEntities(params.entities ?? []));

  return records
    .map(record => {
      const data = toEpisodicData(record);
      const memTokens = tokenize(`${data.title} ${data.summary} ${data.entities.join(' ')}`);
      const lexical = overlap(queryTokens, memTokens);
      const entityScore = requestedEntities.size
        ? data.entities.filter(e => requestedEntities.has(e)).length / requestedEntities.size
        : 0;
      const ageHours = (Date.now() - new Date(data.eventTimestamp).getTime()) / 3600000;
      const recency = Math.exp(-ageHours / (24 * 30)); // 30-day half-life
      const relevance = lexical * 0.45 + entityScore * 0.35 + recency * 0.1 + data.importance * 0.1;
      return { ...data, _relevance: relevance };
    })
    .filter(r => (r as any)._relevance > 0.1 || requestedEntities.size > 0)
    .sort((a, b) => (b as any)._relevance - (a as any)._relevance)
    .slice(0, limit)
    .map(({ _relevance: _, ...data }) => data as EpisodicEventData);
}

export async function listEpisodes(identity: string, params?: {
  eventType?: string;
  conversationId?: string;
  limit?: number;
}): Promise<EpisodicEventData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const records = await prisma.episodicEvent.findMany({
    where: {
      ownerKey,
      ...(params?.eventType ? { eventType: params.eventType } : {}),
      ...(params?.conversationId ? { conversationId: params.conversationId } : {}),
    },
    orderBy: [{ importance: 'desc' }, { eventTimestamp: 'desc' }],
    take: Math.min(params?.limit ?? 50, 200),
  });
  return records.map(toEpisodicData);
}

export async function deleteEpisode(identity: string, id: string): Promise<boolean> {
  const ownerKey = memoryOwnerKey(identity);
  const result = await prisma.episodicEvent.deleteMany({ where: { id, ownerKey } });
  return result.count > 0;
}

function toEpisodicData(record: any): EpisodicEventData {
  return {
    id: record.id,
    conversationId: record.conversationId,
    eventType: record.eventType,
    title: record.title,
    summary: record.summary,
    entities: parseJson<string[]>(record.entitiesJson, []),
    documentIds: parseJson<string[]>(record.documentIds, []),
    sourceMessageId: record.sourceMessageId,
    outcome: record.outcome,
    importance: record.importance,
    confidence: record.confidence,
    metadata: parseJson<Record<string, unknown>>(record.metadataJson, {}),
    eventTimestamp: record.eventTimestamp.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}
function normalizeEntities(vals: string[]) {
  return [...new Set(vals.map(v => v.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
}
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2));
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let count = 0;
  for (const t of a) if (b.has(t)) count++;
  return count / Math.max(a.size, b.size);
}
function similar(a: string, b: string): boolean {
  const ta = tokenize(a), tb = tokenize(b);
  return overlap(ta, tb) > 0.7;
}
function clamp(v: number) { return Math.max(0, Math.min(1, v)); }
