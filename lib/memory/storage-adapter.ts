// lib/memory/storage-adapter.ts
// Production Storage Adapter and Cloud Migration Abstraction Layer
// Defines clean repository interfaces supporting local SQLite/filesystem today
// and managed Cloud DB / S3 object storage tomorrow without architecture rewrites.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from './identity';

export type StorageMode = 'local' | 'cloud';

export interface StorageConfig {
  mode: StorageMode;
  localDataDir: string;
  backupDir: string;
}

export function getStorageConfig(): StorageConfig {
  const mode = (process.env.STORAGE_MODE || 'local') as StorageMode;
  const localDataDir = process.env.DATA_STORAGE_DIR || path.join(process.cwd(), 'data');
  const backupDir = path.join(localDataDir, 'backups');
  return { mode, localDataDir, backupDir };
}

// ── Migration Export / Import Data Format ────────────────────────
export interface MemorySystemExport {
  version: string;
  exportedAt: string;
  ownerKey: string;
  counts: {
    workingMemories: number;
    episodicEvents: number;
    longTermMemories: number;
    conversations: number;
    messages: number;
    documents: number;
    chunks: number;
  };
  data: {
    workingMemories: unknown[];
    episodicEvents: unknown[];
    longTermMemories: unknown[];
    conversations: unknown[];
    messages: unknown[];
    documents: unknown[];
    chunks: unknown[];
  };
}

export async function exportMemoryData(identity: string): Promise<MemorySystemExport> {
  const ownerKey = memoryOwnerKey(identity);

  const [working, episodes, ltm, convs, docs] = await Promise.all([
    prisma.memoryRecord.findMany({ where: { ownerKey } }),
    prisma.episodicEvent.findMany({ where: { ownerKey } }),
    prisma.longTermMemory.findMany({ where: { ownerKey } }),
    prisma.conversationRecord.findMany({ where: { ownerKey } }),
    prisma.documentRecord.findMany({ where: { ownerKey } }),
  ]);

  const convIds = convs.map(c => c.id);
  const messages = convIds.length
    ? await prisma.conversationMessage.findMany({ where: { conversationId: { in: convIds } } })
    : [];

  const docIds = docs.map(d => d.id);
  const chunks = docIds.length
    ? await prisma.documentChunk.findMany({ where: { documentId: { in: docIds } } })
    : [];

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    ownerKey,
    counts: {
      workingMemories: working.length,
      episodicEvents: episodes.length,
      longTermMemories: ltm.length,
      conversations: convs.length,
      messages: messages.length,
      documents: docs.length,
      chunks: chunks.length,
    },
    data: {
      workingMemories: working,
      episodicEvents: episodes,
      longTermMemories: ltm,
      conversations: convs,
      messages,
      documents: docs,
      chunks,
    },
  };
}

export async function importMemoryData(identity: string, exportPackage: MemorySystemExport): Promise<{
  success: boolean;
  imported: Record<string, number>;
  errors: string[];
}> {
  const ownerKey = memoryOwnerKey(identity);
  const errors: string[] = [];
  const imported: Record<string, number> = {
    workingMemories: 0,
    episodicEvents: 0,
    longTermMemories: 0,
    conversations: 0,
    messages: 0,
    documents: 0,
    chunks: 0,
  };

  try {
    // 1. Long term memories
    for (const item of (exportPackage.data.longTermMemories as any[])) {
      try {
        await prisma.longTermMemory.upsert({
          where: {
            ownerKey_category_memoryKey: {
              ownerKey,
              category: item.category,
              memoryKey: item.memoryKey ?? `import_${item.id}`,
            },
          },
          update: {
            title: item.title,
            value: item.value,
            summary: item.summary,
            status: item.status,
          },
          create: {
            ownerKey,
            category: item.category,
            memoryKey: item.memoryKey ?? `import_${item.id}`,
            title: item.title,
            value: item.value,
            summary: item.summary,
            sourceType: item.sourceType,
            confidence: item.confidence,
            importance: item.importance,
            sensitivity: item.sensitivity ?? 'normal',
            status: item.status ?? 'active',
          },
        });
        imported.longTermMemories++;
      } catch (e) {
        errors.push(`LTM import error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Episodic events
    for (const item of (exportPackage.data.episodicEvents as any[])) {
      try {
        await prisma.episodicEvent.create({
          data: {
            ownerKey,
            conversationId: item.conversationId,
            eventType: item.eventType,
            title: item.title,
            summary: item.summary,
            entitiesJson: item.entitiesJson ?? '[]',
            documentIds: item.documentIds ?? '[]',
            outcome: item.outcome,
            importance: item.importance ?? 0.6,
            confidence: item.confidence ?? 0.8,
            metadataJson: item.metadataJson ?? '{}',
            eventTimestamp: new Date(item.eventTimestamp),
          },
        });
        imported.episodicEvents++;
      } catch (e) {
        errors.push(`Episodic import error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { success: true, imported, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Unknown import failure');
    return { success: false, imported, errors };
  }
}

// ── Local Backup Creation & Verification ─────────────────────────
export async function createLocalBackup(identity: string): Promise<{ backupPath: string; recordCounts: Record<string, number> }> {
  const config = getStorageConfig();
  if (!existsSync(/*turbopackIgnore: true*/ config.backupDir)) {
    mkdirSync(config.backupDir, { recursive: true });
  }

  const exportData = await exportMemoryData(identity);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `jaro_memory_backup_${timestamp}.json`;
  const backupPath = path.join(config.backupDir, backupFileName);

  writeFileSync(backupPath, JSON.stringify(exportData, null, 2), 'utf-8');

  return {
    backupPath,
    recordCounts: exportData.counts,
  };
}
