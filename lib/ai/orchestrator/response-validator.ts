// lib/ai/orchestrator/response-validator.ts
// Post-generation validation: evidence grounding, provider-name scrubbing, freshness truth, and compliance guardrails.

import type { ResearchSourceMeta } from '@/types/research';
import type { DataFreshnessState } from '@/lib/execution/tool-schemas';
import { validateResponseEvidence } from '@/lib/validation/financial-accuracy';
import { redactSecrets } from '@/lib/security/redactor';

export interface ResponseValidationSummary {
  passed: boolean;
  warnings: string[];
  sanitizedText: string;
}

const BANNED_PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/\*Source:\s*Yahoo Finance[^*\n]*\*\./gi, ''],
  [/\*Source:\s*Yahoo Finance[^*\n]*\*/gi, ''],
  [/Source:\s*Yahoo Finance[^\n]*/gi, ''],
  [/\(may be delayed 15[–—-]20\s*min\)/gi, '(delayed market quote)'],
  [/\byahoo finance\b/gi, 'delayed exchange feed'],
];

export function validateAndSanitizeFinalResponse(params: {
  text: string;
  evidenceText: string;
  sources: ResearchSourceMeta[];
  freshness: DataFreshnessState;
  isResearchResponse: boolean;
}): ResponseValidationSummary {
  let clean = redactSecrets(params.text);

  for (const [pattern, replacement] of BANNED_PROVIDER_PATTERNS) {
    clean = clean.replace(pattern, replacement);
  }

  // Ensure delayed/EOD feed responses do not claim real-time live tick status
  if (params.freshness !== 'realtime') {
    clean = clean.replace(/\bVerified real-time exchange session close\b/gi, 'Verified exchange session close (delayed/EOD feed)');
    clean = clean.replace(/\bNSE Cash-Equity Real-time Market Feed\b/gi, 'NSE Cash-Equity Exchange Feed');
    clean = clean.replace(/\bReal-time Exchange Market Feed\b/gi, 'Exchange Market Feed');
  }

  const evidenceReport = validateResponseEvidence({
    responseText: clean,
    evidenceText: params.evidenceText,
    sources: params.sources,
    freshness: params.freshness,
    isResearchResponse: params.isResearchResponse,
  });

  return {
    passed: evidenceReport.valid,
    warnings: evidenceReport.warnings,
    sanitizedText: clean,
  };
}
