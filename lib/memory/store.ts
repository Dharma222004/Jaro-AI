import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from './identity';
import type { MemoryCandidate, MemoryRecordData, MemoryType, RetrievedMemory } from '@/types/memory';

export async function createOrUpdateMemory(identity: string, candidate: MemoryCandidate): Promise<MemoryRecordData | null> {
  const ownerKey = memoryOwnerKey(identity);
  const entities = normalizeEntities(candidate.entities ?? []);
  const summary = candidate.summary.trim().slice(0, 1_200);
  if (!summary) return null;
  const scopeByConversation = candidate.type === 'working' || candidate.type === 'episodic';
  const duplicate = await prisma.memoryRecord.findFirst({
    where: {
      ownerKey,
      type: candidate.type,
      active: true,
      ...(candidate.type === 'working' ? {} : { summary }),
      ...(scopeByConversation ? { conversationId: candidate.conversationId ?? null } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });
  const payload = {
    eventType: candidate.eventType,
    conversationId: candidate.conversationId,
    summary,
    contentJson: candidate.content ? JSON.stringify(candidate.content) : null,
    entitiesJson: JSON.stringify(entities),
    sourceMessageId: candidate.sourceMessageId,
    sourceReportId: candidate.sourceReportId,
    confidence: clamp(candidate.confidence ?? 0.8),
    importance: clamp(candidate.importance ?? 0.5),
    expiresAt: candidate.expiresAt,
    active: true,
  };
  const record = duplicate
    ? await prisma.memoryRecord.update({ where: { id: duplicate.id }, data: payload })
    : await prisma.memoryRecord.create({ data: { ownerKey, type: candidate.type, ...payload } });
  if (candidate.type === 'working' && candidate.conversationId) {
    await prisma.memoryRecord.updateMany({
      where: { ownerKey, type: 'working', conversationId: candidate.conversationId, active: true, id: { not: record.id } },
      data: { active: false },
    });
  }
  return toData(record);
}

export async function retrieveMemories(identity: string, params: {
  query: string;
  conversationId?: string;
  entities?: string[];
  types?: MemoryType[];
  limit?: number;
}): Promise<RetrievedMemory[]> {
  const ownerKey = memoryOwnerKey(identity);
  const now = new Date();
  await prisma.memoryRecord.updateMany({
    where: { ownerKey, active: true, expiresAt: { lte: now } },
    data: { active: false },
  });
  const records = await prisma.memoryRecord.findMany({
    where: {
      ownerKey,
      active: true,
      ...(params.types?.length ? { type: { in: params.types } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 120,
  });
  const queryTokens = tokens(params.query);
  const requestedEntities = new Set(normalizeEntities(params.entities ?? []));
  const pronounFollowUp = /\b(it|its|they|their|that company|same company|this stock|the stock|which one)\b/i.test(params.query);
  const seenConsolidated = new Set<string>();
  const ranked = records
    .filter((record) => {
      if (record.type === 'episodic') return true;
      const key = record.type === 'working' ? `${record.type}:${record.conversationId}` : `${record.type}:${record.summary}`;
      if (seenConsolidated.has(key)) return false;
      seenConsolidated.add(key);
      return true;
    })
    .filter((record) => record.type !== 'working' || record.conversationId === params.conversationId)
    .map((record) => {
      const data = toData(record);
      const memoryTokens = tokens(`${data.summary} ${data.entities.join(' ')}`);
      const lexical = overlap(queryTokens, memoryTokens);
      const entityMatches = data.entities.filter((entity) => requestedEntities.has(entity)).length;
      const entityScore = requestedEntities.size ? entityMatches / requestedEntities.size : 0;
      const ageDays = Math.max(0, (Date.now() - new Date(data.updatedAt).getTime()) / 86_400_000);
      const recency = Math.exp(-ageDays / recencyHalfLife(data.type));
      const workingBoost = data.type === 'working' && data.conversationId === params.conversationId ? 0.55 : 0;
      const episodicPronounBoost = pronounFollowUp && data.type === 'episodic' ? 0.2 : 0;
      const relevance = lexical * 0.38 + entityScore * 0.32 + recency * 0.12 + data.importance * 0.12 + workingBoost + episodicPronounBoost;
      return { ...data, relevance: Math.min(1, relevance), recency };
    })
    .filter((memory) => memory.relevance >= 0.16 || memory.type === 'working')
    .sort((a, b) => b.relevance - a.relevance || b.importance - a.importance)
    .slice(0, Math.min(params.limit ?? 8, 12));

  if (ranked.length) {
    await prisma.memoryRecord.updateMany({
      where: { ownerKey, id: { in: ranked.map((memory) => memory.id) } },
      data: { lastAccessedAt: now },
    });
  }
  return ranked;
}

export async function listMemories(identity: string, type?: MemoryType, limit = 100) {
  const ownerKey = memoryOwnerKey(identity);
  const records = await prisma.memoryRecord.findMany({
    where: { ownerKey, active: true, ...(type ? { type } : {}) },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: Math.min(limit, 200),
  });
  return records.map(toData);
}

export async function updateMemory(identity: string, id: string, patch: { summary?: string; importance?: number; active?: boolean }) {
  const ownerKey = memoryOwnerKey(identity);
  const existing = await prisma.memoryRecord.findFirst({ where: { id, ownerKey } });
  if (!existing) return null;
  const record = await prisma.memoryRecord.update({
    where: { id },
    data: {
      ...(patch.summary != null ? { summary: patch.summary.trim().slice(0, 1_200) } : {}),
      ...(patch.importance != null ? { importance: clamp(patch.importance) } : {}),
      ...(patch.active != null ? { active: patch.active } : {}),
    },
  });
  return toData(record);
}

export async function deleteMemory(identity: string, id: string) {
  const ownerKey = memoryOwnerKey(identity);
  return prisma.memoryRecord.deleteMany({ where: { id, ownerKey } });
}

export async function deleteAllMemories(identity: string) {
  const ownerKey = memoryOwnerKey(identity);
  return prisma.memoryRecord.deleteMany({ where: { ownerKey } });
}

type PrismaMemory = Awaited<ReturnType<typeof prisma.memoryRecord.findFirst>> & {};

function toData(record: NonNullable<PrismaMemory>): MemoryRecordData {
  return {
    id: record.id,
    type: record.type as MemoryType,
    eventType: record.eventType,
    conversationId: record.conversationId,
    summary: record.summary,
    content: parseObject(record.contentJson),
    entities: parseArray(record.entitiesJson),
    sourceMessageId: record.sourceMessageId,
    sourceReportId: record.sourceReportId,
    confidence: record.confidence,
    importance: record.importance,
    active: record.active,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    lastAccessedAt: record.lastAccessedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; } catch { return null; }
}
function parseArray(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
}
function normalizeEntities(values: string[]) { return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))].slice(0, 20); }
function tokens(value: string) { return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length > 2)); }
function overlap(a: Set<string>, b: Set<string>) { if (!a.size || !b.size) return 0; let count = 0; for (const item of a) if (b.has(item)) count += 1; return count / Math.max(a.size, b.size); }
function recencyHalfLife(type: MemoryType) { return type === 'working' ? 2 : type === 'episodic' ? 45 : type === 'semantic' ? 90 : 180; }
function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
