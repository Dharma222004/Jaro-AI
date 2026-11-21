export interface ResearchEvalResult {
  overallConfidence: 'high' | 'moderate' | 'limited';
  confidenceScore: number;
  sourceCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  sourceScores: SourceQualityScore[];
  citationCoverage: number;
  conflictCount: number;
  unresolvedConflicts: string[];
  recommendations: string[];
  evaluatedAt: string;
}

export interface SourceQualityScore {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  authority: 'high' | 'medium' | 'low';
  sourceType: string;
  recencyScore: number;
  relevanceScore: number;
  authorityScore: number;
  citationConfidence: number;
  groundingQuality: 'high' | 'moderate' | 'limited';
  flags: string[];
}
