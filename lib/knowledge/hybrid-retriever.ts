// lib/knowledge/hybrid-retriever.ts
// Unified financial hybrid retriever across user RAG documents, company disclosures, and cached research dossiers.

import { prisma } from '@/lib/database/client';
import { hybridSearchChunks } from '@/lib/documents/store';
import { wrapUntrustedContent } from '@/lib/security/input-guard';
import { detectPeriodDiversity, type FinancialKnowledgeDocument } from './source-manager';
import { rerankFinancialDocuments, type RankedFinancialDocument } from './reranker';

export interface HybridKnowledgeResult {
  passages: RankedFinancialDocument[];
  periodNotice: string | null;
  formattedEvidence: string;
}

export async function retrieveFinancialKnowledge(params: {
  identity?: string | null;
  query: string;
  tickers?: string[];
  companyId?: string;
  topK?: number;
}): Promise<HybridKnowledgeResult> {
  const docs: FinancialKnowledgeDocument[] = [];
  const retrievalTimestamp = new Date().toISOString();

  // 1. Authenticated user-uploaded RAG documents (strictly owner-isolated)
  if (params.identity) {
    try {
      const userChunks = await hybridSearchChunks(params.identity, {
        query: params.query,
        companyId: params.companyId,
        topK: params.topK ?? 6,
      });

      for (const chunk of userChunks) {
        docs.push({
          id: `doc_${chunk.documentId}_${chunk.chunkIndex}`,
          title: chunk.documentTitle,
          content: chunk.content,
          ticker: params.tickers?.[0] ?? null,
          sourceProvider: 'user_document_kb',
          documentType: chunk.contentType || 'research',
          publicationDate: null,
          retrievalTimestamp,
          reportingPeriod: null,
          sourceUrl: null,
          authority: 'high',
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle,
          rawScore: chunk.score,
        });
      }
    } catch {
      // Non-fatal if document RAG unavailable
    }
  }

  // 2. Stored exchange disclosures / ResearchSources for requested tickers
  if (params.tickers && params.tickers.length > 0) {
    try {
      const normalizedTickers = params.tickers.map((t) => t.toUpperCase()).slice(0, 4);
      const companies = await prisma.company.findMany({
        where: { ticker: { in: normalizedTickers } },
        include: {
          reports: {
            where: { status: 'completed' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sources: true },
          },
        },
      });

      for (const company of companies) {
        const report = company.reports[0];
        if (!report) continue;
        for (const src of report.sources.slice(0, 6)) {
          if (!src.snippet) continue;
          docs.push({
            id: `src_${src.id}`,
            title: src.title,
            content: src.snippet,
            ticker: company.ticker,
            sourceProvider: src.domain,
            documentType: src.sourceType ?? 'other',
            publicationDate: src.publishedAt?.toISOString() ?? null,
            retrievalTimestamp: src.retrievedAt.toISOString(),
            reportingPeriod: src.reportingPeriod ?? null,
            sourceUrl: src.url,
            authority: (src.authority === 'high' || src.authority === 'medium' ? src.authority : 'low'),
            rawScore: src.relevance ?? 0.5,
          });
        }
      }
    } catch {
      // Non-fatal DB fallback
    }
  }

  const passages = rerankFinancialDocuments(docs, {
    query: params.query,
    tickers: params.tickers,
    topK: params.topK ?? 6,
  });

  const mixedPeriods = detectPeriodDiversity(passages);
  const periodNotice =
    mixedPeriods.length > 1
      ? `Retrieved sources span multiple reporting periods (${mixedPeriods.join(', ')}). Keep metrics tied to their stated periods.`
      : null;

  const formattedEvidence = passages.length
    ? passages
        .map((p) => {
          const meta = [
            p.ticker ? `Ticker: ${p.ticker}` : null,
            `Source: ${p.sourceProvider}`,
            `Type: ${p.documentType}`,
            p.reportingPeriod ? `Period: ${p.reportingPeriod}` : null,
            p.publicationDate ? `Published: ${p.publicationDate.slice(0, 10)}` : null,
            p.pageNumber ? `Page: ${p.pageNumber}` : null,
            p.sectionTitle ? `Section: ${p.sectionTitle}` : null,
          ]
            .filter(Boolean)
            .join(' | ');
          return wrapUntrustedContent(`${p.title} (${meta})`, p.content, 1200);
        })
        .join('\n\n')
    : '';

  return { passages, periodNotice, formattedEvidence };
}
