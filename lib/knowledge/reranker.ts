// lib/knowledge/reranker.ts
// Financial multi-factor reranker combining relevance, authority, recency, and ticker alignment.

import { computeRecencyDecay, scoreSourceAuthority, type FinancialKnowledgeDocument } from './source-manager';

export interface RankedFinancialDocument extends FinancialKnowledgeDocument {
  finalScore: number;
  scoreBreakdown: {
    relevance: number;
    authority: number;
    recency: number;
    entityMatch: number;
  };
}

export function rerankFinancialDocuments(
  docs: FinancialKnowledgeDocument[],
  params: { query: string; tickers?: string[]; topK?: number },
): RankedFinancialDocument[] {
  const topK = Math.min(params.topK ?? 8, 20);
  const tickerSet = new Set((params.tickers ?? []).map((t) => t.toUpperCase()));
  const queryTerms = new Set(
    params.query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
  );

  const ranked = docs.map((doc) => {
    const auth = scoreSourceAuthority(doc);
    const recency = computeRecencyDecay(doc.publicationDate ?? doc.retrievalTimestamp, 120);

    const textUpper = `${doc.ticker ?? ''} ${doc.title} ${doc.content.slice(0, 300)}`.toUpperCase();
    let entityMatch = 0;
    if (tickerSet.size > 0) {
      let matched = 0;
      for (const t of tickerSet) {
        if (textUpper.includes(t)) matched++;
      }
      entityMatch = matched / tickerSet.size;
    }

    const docWords = new Set(doc.content.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    let overlapCount = 0;
    for (const q of queryTerms) {
      if (docWords.has(q)) overlapCount++;
    }
    const keywordOverlap = queryTerms.size > 0 ? overlapCount / queryTerms.size : 0;
    const relevance = Math.max(doc.rawScore, keywordOverlap);

    const finalScore = relevance * 0.45 + auth * 0.25 + recency * 0.15 + entityMatch * 0.15;

    return {
      ...doc,
      finalScore: Math.round(finalScore * 1000) / 1000,
      scoreBreakdown: {
        relevance: round2(relevance),
        authority: round2(auth),
        recency: round2(recency),
        entityMatch: round2(entityMatch),
      },
    };
  });

  return ranked
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, topK);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
