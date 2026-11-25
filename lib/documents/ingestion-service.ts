// lib/documents/ingestion-service.ts
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from './parser';
import { chunkDocument } from './chunker';
import { generateEmbedding } from './embedding';
import { createDocumentRecord, saveDocumentChunks, updateDocumentStatus } from './store';
import { memoryOwnerKey } from '@/lib/memory/identity';
import { ensurePathWithinDirectory, sanitizeStorageFilename } from '@/lib/security/input-guard';
import { recordSecurityAudit } from '@/lib/security/audit-logger';

const DOCS_BASE_DIR = process.env.DOCS_STORAGE_DIR ?? path.join(process.cwd(), 'data', 'documents');

export interface IngestionResult {
  documentId: string;
  status: 'indexed' | 'partial' | 'failed';
  chunkCount: number;
  pageCount: number;
  warnings: string[];
  errors: string[];
}

export async function ingestDocument(identity: string, params: {
  filePath: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  title?: string;
  sourceUrl?: string;
  companyId?: string;
  documentCategory?: string;
  publicationDate?: Date;
  reportingPeriod?: string;
  reportingBasis?: string;
}): Promise<IngestionResult> {
  const ownerKey = memoryOwnerKey(identity);
  const errors: string[] = [];

  if (!existsSync(params.filePath)) {
    return { documentId: '', status: 'failed', chunkCount: 0, pageCount: 0, warnings: [], errors: ['File not found: ' + params.filePath] };
  }

  // Content hash for deduplication
  const fileBuffer = readFileSync(params.filePath);
  const contentHash = createHash('sha256').update(fileBuffer).digest('hex');

  // Ensure storage directory exists and sanitize filename against path traversal
  const ownerDir = ensurePathWithinDirectory(DOCS_BASE_DIR, path.join(/*turbopackIgnore: true*/ DOCS_BASE_DIR, ownerKey.slice(0, 16)));
  if (!existsSync(/*turbopackIgnore: true*/ ownerDir)) mkdirSync(ownerDir, { recursive: true });

  // Copy file to managed storage using strictly sanitized filename inside ownerDir
  const safeFileName = sanitizeStorageFilename(params.fileName);
  const storageKey = ensurePathWithinDirectory(ownerDir, path.join(ownerDir, `${Date.now()}_${safeFileName}`));
  writeFileSync(storageKey, fileBuffer);

  // Create document record
  const docRecord = await createDocumentRecord(identity, {
    title: params.title ?? safeFileName,
    fileName: safeFileName,
    fileType: params.fileType,
    fileSize: params.fileSize ?? fileBuffer.byteLength,
    sourceUrl: params.sourceUrl,
    companyId: params.companyId,
    documentCategory: params.documentCategory,
    publicationDate: params.publicationDate,
    reportingPeriod: params.reportingPeriod,
    reportingBasis: params.reportingBasis,
    storageKey,
    contentHash,
  });

  await updateDocumentStatus(identity, docRecord.id, 'processing');

  // Parse document
  let parsed;
  try {
    parsed = await parseDocument(storageKey, params.fileType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Parse error';
    errors.push(msg);
    await updateDocumentStatus(identity, docRecord.id, 'failed', { ingestionError: msg });
    return { documentId: docRecord.id, status: 'failed', chunkCount: 0, pageCount: 0, warnings: [], errors };
  }

  // Chunk document
  const rawChunks = chunkDocument(parsed);

  // Generate embeddings (best-effort)
  const chunksWithEmbeddings = await Promise.all(
    rawChunks.map(async (chunk) => {
      const embedding = await generateEmbedding(chunk.content).catch(() => null);
      return {
        ...chunk,
        embeddingJson: embedding ? JSON.stringify(embedding) : undefined,
      };
    })
  );

  // Save chunks
  await saveDocumentChunks(docRecord.id, ownerKey, chunksWithEmbeddings);
  await updateDocumentStatus(identity, docRecord.id, 'indexed', {
    pageCount: parsed.metadata.pageCount ?? parsed.pages.length,
    chunkCount: chunksWithEmbeddings.length,
  });

  await recordSecurityAudit({
    ownerKey,
    eventType: 'memory_change',
    action: 'document_ingest',
    resource: docRecord.id,
    status: errors.length ? 'error' : 'success',
    metadata: { fileName: safeFileName, chunkCount: chunksWithEmbeddings.length },
  });

  return {
    documentId: docRecord.id,
    status: errors.length ? 'partial' : 'indexed',
    chunkCount: chunksWithEmbeddings.length,
    pageCount: parsed.metadata.pageCount ?? parsed.pages.length,
    warnings: parsed.warnings,
    errors,
  };
}
