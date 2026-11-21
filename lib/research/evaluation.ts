import type { ResearchSourceMeta } from '@/types/research';

export type GroundingQuality = 'high' | 'moderate' | 'limited';

export interface SourceQualityScore {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  authority: 'high' | 'medium' | 'low';
  sourceType: ResearchSourceMeta['sourceType'];
  recencyScore: number; // 0-1
  relevanceScore: number; // 0-1
  authorityScore: number; // 0-1
  citationConfidence: number; // 0-1
  groundingQuality: GroundingQuality;
  flags: string[];
}

export interface ResearchEvalResult {
  overallConfidence: 'high' | 'moderate' | 'limited';
  confidenceScore: number; // 0-100
  sourceCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  sourceScores: SourceQualityScore[];
  citationCoverage: number; // % of claims with citations
  conflictCount: number;
  unresolvedConflicts: string[];
  recommendations: string[];
  evaluatedAt: string;
}

const AUTHORITY_SCORE: Record<'high' | 'medium' | 'low', number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

const SOURCE_TYPE_SCORE: Record<ResearchSourceMeta['sourceType'], number> = {
  annual_report: 1.0,
  exchange_filing: 1.0,
  investor_presentation: 0.9,
  financial_database: 0.7,
  news: 0.5,
  analysis: 0.4,
  other: 0.2,
};

function recencyScore(retrievedAt?: string): number {
  if (!retrievedAt) return 0.2;
  const ageDays = Math.max(0, (Date.now() - new Date(retrievedAt).getTime()) / 86_400_000);
  // Half-life of 90 days
  return Math.round(Math.exp(-ageDays / 90) * 100) / 100;
}

function relevanceScore(source: ResearchSourceMeta, queryTerms: string[]): number {
  const text = `${source.title} ${source.snippet ?? ''} ${source.domain}`.toLowerCase();
  if (!queryTerms.length) return 0.5;
  const matches = queryTerms.filter((term) => text.includes(term.toLowerCase())).length;
  return Math.round(Math.min(1, matches / queryTerms.length) * 100) / 100;
}

function groundQuality(confidence: number): GroundingQuality {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.45) return 'moderate';
  return 'limited';
}

/**
 * Evaluates research sources for grounding quality, citation confidence,
 * and overall research confidence. Mirrors RAG-eval concepts without
 * requiring an external vector service.
 */
export function evaluateResearchSources(params: {
  sources: ResearchSourceMeta[];
  query: string;
  conflictCount?: number;
  unresolvedConflicts?: string[];
  citationCoverage?: number;
}): ResearchEvalResult {
  const { sources, query = '', conflictCount = 0, unresolvedConflicts = [], citationCoverage = 0 } = params;
  const queryTokens = query.split(/\s+/).filter((t) => t.length > 2);

  const sourceScores: SourceQualityScore[] = sources.map((source) => {
    const authority = source.authority;
    const authScore = AUTHORITY_SCORE[authority];
    const typeScore = SOURCE_TYPE_SCORE[source.sourceType];
    const recency = recencyScore(source.retrievedAt);
    const relevance = relevanceScore(source, queryTokens);

    // Composite citation confidence: weighted blend
    const confidence = round2(authScore * 0.4 + typeScore * 0.25 + recency * 0.2 + relevance * 0.15);
    const flags: string[] = [];

    if (!source.url) flags.push('Missing source URL');
    if (!source.retrievedAt) flags.push('Missing retrieval timestamp');
    if (recency < 0.3) flags.push('Stale source (>90 days old)');
    if (authority === 'low') flags.push('Low authority source');
    if (source.sourceType === 'other') flags.push('Unverified source type');
    if (!source.snippet) flags.push('No content snippet available');

    return {
      sourceId: source.id ?? source.url,
      url: source.url,
      title: source.title,
      domain: source.domain,
      authority,
      sourceType: source.sourceType,
      recencyScore: recency,
      relevanceScore: relevance,
      authorityScore: authScore,
      citationConfidence: confidence,
      groundingQuality: groundQuality(confidence),
      flags,
    };
  });

  const primarySourceCount = sourceScores.filter((s) => s.authority === 'high').length;
  const secondarySourceCount = sourceScores.length - primarySourceCount;

  const avgConfidence =
    sourceScores.length > 0
      ? round2(sourceScores.reduce((sum, s) => sum + s.citationConfidence, 0) / sourceScores.length)
      : 0;

  const confidenceScore = round2(avgConfidence * 100);

  let overallConfidence: 'high' | 'moderate' | 'limited' = 'moderate';
  if (confidenceScore >= 75 && conflictCount === 0 && primarySourceCount >= 2) {
    overallConfidence = 'high';
  } else if (confidenceScore < 45 || conflictCount > 2 || primarySourceCount === 0) {
    overallConfidence = 'limited';
  }

  const recommendations: string[] = [];
  if (primarySourceCount === 0) {
    recommendations.push('Add primary regulatory sources (exchange filings, annual reports) for higher confidence.');
  }
  if (conflictCount > 0) {
    recommendations.push(`Resolve ${conflictCount} cross-source conflict(s) before acting on this research.`);
  }
  if (citationCoverage < 50) {
    recommendations.push('Increase citation coverage; many claims lack source attribution.');
  }
  const lowConfSources = sourceScores.filter((s) => s.groundingQuality === 'limited');
  if (lowConfSources.length) {
    recommendations.push(`Review or replace ${lowConfSources.length} low-confidence source(s).`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Research sources meet baseline grounding quality standards.');
  }

  return {
    overallConfidence,
    confidenceScore,
    sourceCount: sourceScores.length,
    primarySourceCount,
    secondarySourceCount,
    sourceScores,
    citationCoverage: round2(citationCoverage),
    conflictCount,
    unresolvedConflicts,
    recommendations,
    evaluatedAt: new Date().toISOString(),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
