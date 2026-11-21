// lib/memory/long-term-store.ts
// Production long-term memory: semantic facts, procedural knowledge, preferences, project knowledge

import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from './identity';

export type LTMCategory = 'semantic' | 'procedural' | 'preference' | 'project';

export interface LongTermMemoryData {
  id: string;
  category: LTMCategory;
  memoryKey?: string | null;
  title: string;
  value: string;
  summary: string;
  sourceType?: string | null;
  sourceRef?: string | null;
  confidence: number;
  importance: number;
  sensitivity: string;
  status: string;
  validFrom: string;
  validUntil?: string | null;
  version: number;
  previousId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertLTMParams {
  category: LTMCategory;
  memoryKey?: string;
  title: string;
  value: string;
  summary?: string;
  sourceType?: 'user_explicit' | 'ai_extracted' | 'system';
  sourceRef?: string;
  confidence?: number;
  importance?: number;
  sensitivity?: 'normal' | 'sensitive' | 'restricted';
  validUntil?: Date;
  expirationPolicy?: 'manual' | 'ttl' | 'event_based';
}

export async function upsertLongTermMemory(identity: string, params: UpsertLTMParams): Promise<LongTermMemoryData> {
  const ownerKey = memoryOwnerKey(identity);
  const summary = (params.summary ?? params.value).trim().slice(0, 1200);
  
  // Check for existing by key
  if (params.memoryKey) {
    const existing = await prisma.longTermMemory.findUnique({
      where: { ownerKey_category_memoryKey: { ownerKey, category: params.category, memoryKey: params.memoryKey } },
    });
    if (existing) {
      // Free the unique slot for the new active version while preserving history
      await prisma.longTermMemory.update({
        where: { id: existing.id },
        data: {
          status: 'superseded',
          memoryKey: `${existing.memoryKey}_v${existing.version}_${Date.now()}`,
        },
      });
      const updated = await prisma.longTermMemory.create({
        data: {
          ownerKey, category: params.category, memoryKey: params.memoryKey,
          title: params.title.slice(0, 300), value: params.value.slice(0, 4000), summary,
          sourceType: params.sourceType, sourceRef: params.sourceRef,
          confidence: clamp(params.confidence ?? 0.8), importance: clamp(params.importance ?? 0.7),
          sensitivity: params.sensitivity ?? 'normal', validUntil: params.validUntil,
          expirationPolicy: params.expirationPolicy ?? 'manual',
          version: existing.version + 1, previousId: existing.id,
        },
      });
      return toLTMData(updated);
    }
  }

  const record = await prisma.longTermMemory.create({
    data: {
      ownerKey, category: params.category, memoryKey: params.memoryKey ?? null,
      title: params.title.slice(0, 300), value: params.value.slice(0, 4000), summary,
      sourceType: params.sourceType, sourceRef: params.sourceRef,
      confidence: clamp(params.confidence ?? 0.8), importance: clamp(params.importance ?? 0.7),
      sensitivity: params.sensitivity ?? 'normal', validUntil: params.validUntil,
      expirationPolicy: params.expirationPolicy ?? 'manual',
    },
  });
  return toLTMData(record);
}

export async function retrieveLongTermMemories(identity: string, params: {
  query: string;
  categories?: LTMCategory[];
  limit?: number;
}): Promise<LongTermMemoryData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const now = new Date();
  
  // Expire overdue TTL memories
  await prisma.longTermMemory.updateMany({
    where: { ownerKey, status: 'active', expirationPolicy: 'ttl', validUntil: { lte: now } },
    data: { status: 'expired' },
  });

  const records = await prisma.longTermMemory.findMany({
    where: {
      ownerKey, status: 'active',
      ...(params.categories?.length ? { category: { in: params.categories } } : {}),
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: 150,
  });

  const queryTokens = tokenize(params.query);
  return records
    .map(r => {
      const data = toLTMData(r);
      const memTokens = tokenize(`${data.title} ${data.value} ${data.summary}`);
      const lexical = overlap(queryTokens, memTokens);
      return { ...data, _score: lexical * 0.6 + data.importance * 0.4 };
    })
    .filter(r => (r as any)._score > 0.1)
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .slice(0, Math.min(params.limit ?? 10, 20))
    .map(({ _score: _, ...data }) => data as LongTermMemoryData);
}

export async function listLongTermMemories(identity: string, category?: LTMCategory): Promise<LongTermMemoryData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const records = await prisma.longTermMemory.findMany({
    where: { ownerKey, status: 'active', ...(category ? { category } : {}) },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });
  return records.map(toLTMData);
}

export async function deleteLongTermMemory(identity: string, id: string): Promise<boolean> {
  const ownerKey = memoryOwnerKey(identity);
  const result = await prisma.longTermMemory.updateMany({
    where: { id, ownerKey }, data: { status: 'deleted' },
  });
  return result.count > 0;
}

function toLTMData(r: any): LongTermMemoryData {
  return {
    id: r.id, category: r.category as LTMCategory, memoryKey: r.memoryKey,
    title: r.title, value: r.value, summary: r.summary,
    sourceType: r.sourceType, sourceRef: r.sourceRef,
    confidence: r.confidence, importance: r.importance,
    sensitivity: r.sensitivity, status: r.status,
    validFrom: r.validFrom.toISOString(), validUntil: r.validUntil?.toISOString() ?? null,
    version: r.version, previousId: r.previousId,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
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
function clamp(v: number) { return Math.max(0, Math.min(1, v)); }
