// lib/documents/store.ts
// Document record management and chunk retrieval

import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from '@/lib/memory/identity';
import { cosineSimilarity, generateQueryEmbedding } from './embedding';

export interface DocumentRecordData {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize?: number | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  companyId?: string | null;
  documentCategory: string;
  publicationDate?: string | null;
  reportingPeriod?: string | null;
  reportingBasis?: string | null;
  ingestionStatus: string;
  ingestionError?: string | null;
  pageCount?: number | null;
  chunkCount?: number | null;
  storageKey?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  contentType: string;
  pageNumber?: number | null;
  sectionTitle?: string | null;
  score: number;
}

export async function createDocumentRecord(identity: string, params: {
  title: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  sourceUrl?: string;
  sourceName?: string;
  companyId?: string;
  documentCategory?: string;
  publicationDate?: Date;
  reportingPeriod?: string;
  reportingBasis?: string;
  storageKey?: string;
  contentHash?: string;
}): Promise<DocumentRecordData> {
  const ownerKey = memoryOwnerKey(identity);

  // Check for duplicate by content hash
  if (params.contentHash) {
    const existing = await prisma.documentRecord.findFirst({
      where: { ownerKey, contentHash: params.contentHash, ingestionStatus: { not: 'deleted' } },
    });
    if (existing) return toDocData(existing);
  }

  const record = await prisma.documentRecord.create({
    data: {
      ownerKey, title: params.title.slice(0, 300), fileName: params.fileName.slice(0, 300),
      fileType: params.fileType, fileSize: params.fileSize, sourceUrl: params.sourceUrl,
      sourceName: params.sourceName, companyId: params.companyId,
      documentCategory: params.documentCategory ?? 'general',
      publicationDate: params.publicationDate, reportingPeriod: params.reportingPeriod,
      reportingBasis: params.reportingBasis, storageKey: params.storageKey,
      contentHash: params.contentHash, ingestionStatus: 'uploaded',
    },
  });
  return toDocData(record);
}

export async function updateDocumentStatus(identity: string, id: string, status: string, params?: {
  ingestionError?: string;
  pageCount?: number;
  chunkCount?: number;
}): Promise<void> {
  const ownerKey = memoryOwnerKey(identity);
  await prisma.documentRecord.updateMany({
    where: { id, ownerKey },
    data: { ingestionStatus: status, ...params },
  });
}

export async function saveDocumentChunks(documentId: string, ownerKey: string, chunks: Array<{
  chunkIndex: number;
  content: string;
  contentType: string;
  pageNumber?: number;
  sectionTitle?: string;
  embeddingJson?: string;
  metadata?: Record<string, unknown>;
}>): Promise<void> {
  // Clear existing chunks
  await prisma.documentChunk.deleteMany({ where: { documentId } });

  // Insert in batches
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    await prisma.documentChunk.createMany({
      data: batch.map(c => ({
        documentId, ownerKey,
        chunkIndex: c.chunkIndex, content: c.content.slice(0, 8000),
        contentType: c.contentType, pageNumber: c.pageNumber,
        sectionTitle: c.sectionTitle, embeddingJson: c.embeddingJson,
        metadataJson: JSON.stringify(c.metadata ?? {}),
      })),
    });
  }
  await prisma.documentRecord.update({
    where: { id: documentId },
    data: { chunkCount: chunks.length, ingestionStatus: 'indexed' },
  });
}

export async function hybridSearchChunks(identity: string, params: {
  query: string;
  documentIds?: string[];
  companyId?: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const ownerKey = memoryOwnerKey(identity);
  const topK = Math.min(params.topK ?? 8, 20);

  // Build where clause
  const whereClause: Record<string, unknown> = { ownerKey };
  if (params.documentIds?.length) whereClause.documentId = { in: params.documentIds };
  if (params.companyId) {
    const docIds = await prisma.documentRecord.findMany({
      where: { ownerKey, companyId: params.companyId, ingestionStatus: 'indexed' },
      select: { id: true },
    });
    whereClause.documentId = { in: docIds.map((d: { id: string }) => d.id) };
  }

  const chunks = await prisma.documentChunk.findMany({
    where: whereClause,
    take: 500,
    include: { document: { select: { title: true } } },
  });

  // Lexical scoring
  const queryTokens = tokenize(params.query);

  // Try semantic scoring
  const queryEmbedding = await generateQueryEmbedding(params.query).catch(() => null);

  const scored = chunks.map((chunk: {
    documentId: string;
    chunkIndex: number;
    content: string;
    contentType: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    embeddingJson: string | null;
    document: { title: string } | null;
  }) => {
    const chunkTokens = tokenize(chunk.content);
    const lexicalScore = overlap(queryTokens, chunkTokens);

    let semanticScore = 0;
    if (queryEmbedding && chunk.embeddingJson) {
      try {
        const chunkEmb = JSON.parse(chunk.embeddingJson) as number[];
        semanticScore = cosineSimilarity(queryEmbedding, chunkEmb);
      } catch {
        // ignore parse errors
      }
    }

    const score = queryEmbedding ? lexicalScore * 0.4 + semanticScore * 0.6 : lexicalScore;
    return {
      documentId: chunk.documentId,
      documentTitle: chunk.document?.title ?? 'Unknown',
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentType: chunk.contentType,
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
      score,
    };
  });

  return scored
    .filter((c: RetrievedChunk) => c.score > 0.05)
    .sort((a: RetrievedChunk, b: RetrievedChunk) => b.score - a.score)
    .slice(0, topK);
}

export async function listDocuments(identity: string, params?: {
  companyId?: string;
  category?: string;
  status?: string;
}): Promise<DocumentRecordData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const records = await prisma.documentRecord.findMany({
    where: {
      ownerKey,
      ingestionStatus: { not: 'deleted' },
      ...(params?.companyId ? { companyId: params.companyId } : {}),
      ...(params?.category ? { documentCategory: params.category } : {}),
      ...(params?.status ? { ingestionStatus: params.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return records.map(toDocData);
}

export async function deleteDocument(identity: string, id: string): Promise<boolean> {
  const ownerKey = memoryOwnerKey(identity);
  const result = await prisma.documentRecord.updateMany({
    where: { id, ownerKey }, data: { ingestionStatus: 'deleted' },
  });
  if (result.count > 0) {
    await prisma.documentChunk.deleteMany({ where: { documentId: id } });
  }
  return result.count > 0;
}

function toDocData(r: {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  companyId: string | null;
  documentCategory: string;
  publicationDate: Date | null;
  reportingPeriod: string | null;
  reportingBasis: string | null;
  ingestionStatus: string;
  ingestionError: string | null;
  pageCount: number | null;
  chunkCount: number | null;
  storageKey: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): DocumentRecordData {
  return {
    id: r.id, title: r.title, fileName: r.fileName, fileType: r.fileType,
    fileSize: r.fileSize, sourceUrl: r.sourceUrl, sourceName: r.sourceName,
    companyId: r.companyId, documentCategory: r.documentCategory,
    publicationDate: r.publicationDate?.toISOString() ?? null,
    reportingPeriod: r.reportingPeriod, reportingBasis: r.reportingBasis,
    ingestionStatus: r.ingestionStatus, ingestionError: r.ingestionError,
    pageCount: r.pageCount, chunkCount: r.chunkCount, storageKey: r.storageKey,
    version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2));
}

function overlap(queryTokens: Set<string>, docTokens: Set<string>): number {
  if (!queryTokens.size || !docTokens.size) return 0;
  let count = 0;
  for (const t of queryTokens) if (docTokens.has(t)) count++;
  return count / queryTokens.size;
}
