// lib/knowledge/source-manager.ts
// Financial source metadata normalization, authority classification, and period-mismatch guards.

import { validateSafeExternalUrl } from '@/lib/security/input-guard';
import type { ResearchSourceMeta } from '@/types/research';

export interface FinancialKnowledgeDocument {
  id: string;
  title: string;
  content: string;
  ticker?: string | null;
  sourceProvider: string;
  documentType: string;
  publicationDate?: string | null;
  retrievalTimestamp: string;
  reportingPeriod?: string | null;
  reportingBasis?: string | null;
  sourceUrl?: string | null;
  authority: 'high' | 'medium' | 'low';
  pageNumber?: number | null;
  sectionTitle?: string | null;
  rawScore: number;
}

const AUTHORITY_WEIGHT: Record<'high' | 'medium' | 'low', number> = {
  high: 1.0,
  medium: 0.65,
  low: 0.35,
};

const DOC_TYPE_WEIGHT: Record<string, number> = {
  annual_report: 1.0,
  exchange_filing: 1.0,
  quarterly_results: 0.95,
  investor_presentation: 0.9,
  transcript: 0.85,
  research: 0.75,
  financial_database: 0.7,
  news: 0.5,
  analysis: 0.45,
  general: 0.4,
  other: 0.3,
};

export function scoreSourceAuthority(doc: Pick<FinancialKnowledgeDocument, 'authority' | 'documentType'>): number {
  const auth = AUTHORITY_WEIGHT[doc.authority] ?? 0.35;
  const docType = DOC_TYPE_WEIGHT[doc.documentType] ?? 0.4;
  return auth * 0.6 + docType * 0.4;
}

export function computeRecencyDecay(dateIso?: string | null, halfLifeDays = 90): number {
  if (!dateIso) return 0.45;
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 0.45;
  const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000);
  return Math.exp(-ageDays / halfLifeDays);
}

export function filterTrustedSources(sources: ResearchSourceMeta[]): ResearchSourceMeta[] {
  return sources.filter((s) => !s.url || validateSafeExternalUrl(s.url).valid);
}

/**
 * Checks whether retrieved financial passages span conflicting reporting periods
 * so downstream synthesis explicitly keeps period boundaries distinct.
 */
export function detectPeriodDiversity(docs: FinancialKnowledgeDocument[]): string[] {
  const periods = new Set(
    docs
      .map((d) => d.reportingPeriod?.trim())
      .filter((p): p is string => Boolean(p && p.length > 0)),
  );
  if (periods.size <= 1) return [];
  return [...periods];
}
