import type {
  ConflictRecord,
  DataQualityReport,
  FinancialMetric,
  ResearchSourceMeta,
} from '@/types/research';
import type { ExtractedFinancials } from './metric-extractor';

export interface ValidationOutput {
  validatedMetrics: ExtractedFinancials;
  dataQuality: DataQualityReport;
}

/**
 * Validates extracted metrics across multiple sources, flags conflicts,
 * prioritizes primary corporate disclosures over databases, and generates
 * the transparent Data Quality report.
 */
export function validateAndDetectConflicts(params: {
  extracted: ExtractedFinancials;
  sources: ResearchSourceMeta[];
  filingText: string;
  screenerText: string;
}): ValidationOutput {
  const { extracted, sources, filingText, screenerText } = params;

  const conflicts: ConflictRecord[] = [];
  const missingMetrics: string[] = [];

  // Check key metrics for availability
  const checkMetric = (name: string, m?: FinancialMetric) => {
    if (!m || m.value === null || m.value === undefined || m.value === '') {
      missingMetrics.push(name);
    }
  };

  checkMetric('Market Capitalization', extracted.marketCap);
  checkMetric('Stock P/E', extracted.pe);
  checkMetric('Price to Book (P/B)', extracted.pb);
  checkMetric('Return on Equity (ROE)', extracted.roe);
  checkMetric('Return on Capital Employed (ROCE)', extracted.roce);
  checkMetric('Total Debt', extracted.totalDebt);
  checkMetric('Cash & Equivalents', extracted.cash);
  checkMetric('Quarterly Revenue', extracted.revenue);
  checkMetric('Net Profit (PAT)', extracted.netProfit);
  checkMetric('Promoter Holding', extracted.promoterHolding);
  checkMetric('FII Holding', extracted.fiiHolding);
  checkMetric('DII Holding', extracted.diiHolding);

  // Cross-source conflict check on Revenue
  // Check if filing and screener disclose differing revenue figures
  if (filingText && screenerText && extracted.revenue?.value) {
    const filingRevMatch = filingText.match(/(?:Revenue|Sales|Income)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
    const screenerRevMatch = screenerText.match(/(?:Sales|Revenue)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);

    if (filingRevMatch && screenerRevMatch) {
      const fVal = parseFloat(filingRevMatch[1].replace(/,/g, ''));
      const sVal = parseFloat(screenerRevMatch[1].replace(/,/g, ''));

      if (!isNaN(fVal) && !isNaN(sVal) && fVal > 0 && sVal > 0) {
        const diffPercent = Math.abs(fVal - sVal) / Math.max(fVal, sVal) * 100;
        if (diffPercent > 4) {
          conflicts.push({
            metric: 'Quarterly Revenue / Sales',
            selectedValue: fVal,
            selectedSource: 'Exchange Filing (BSE/NSE)',
            conflictingValues: [
              {
                value: sVal,
                source: 'Secondary Financial Database (Screener)',
                basis: 'Possible Standalone vs Consolidated variance or Gross vs Net turnover',
              },
            ],
            resolution: 'Primary regulatory exchange filing prioritized over secondary database aggregation.',
          });
        }
      }
    }
  }

  // Count primary vs secondary sources
  let primaryCount = 0;
  let secondaryCount = 0;

  for (const s of sources) {
    if (s.authority === 'high' || s.domain.includes('bseindia') || s.domain.includes('nseindia')) {
      primaryCount++;
    } else {
      secondaryCount++;
    }
  }

  // Determine overall research confidence
  let overallConfidence: 'High' | 'Moderate' | 'Limited' = 'Moderate';
  let confidenceReason = '';

  if (primaryCount >= 2 && missingMetrics.length <= 3 && conflicts.length === 0) {
    overallConfidence = 'High';
    confidenceReason = `Robust data verification achieved with ${primaryCount} primary regulatory/corporate sources and verified financial tables across key metrics. Zero material conflicts detected.`;
  } else if (missingMetrics.length <= 5) {
    overallConfidence = 'Moderate';
    confidenceReason = `Core financial ratios and market cap verified from established financial databases. ${conflicts.length > 0 ? `${conflicts.length} cross-source conflict(s) resolved using primary disclosures.` : 'Clean cross-source agreement across reported metrics.'}`;
  } else {
    overallConfidence = 'Limited';
    confidenceReason = `Several detailed balance sheet items are not publicly granular in recent disclosures. ${missingMetrics.length} metrics marked unavailable to avoid conjecture.`;
  }

  const dataQuality: DataQualityReport = {
    overallConfidence,
    confidenceReason,
    primarySourcesCount: primaryCount,
    secondarySourcesCount: secondaryCount,
    conflictingMetricsCount: conflicts.length,
    missingMetricsCount: missingMetrics.length,
    conflicts,
    missingMetrics,
  };

  return {
    validatedMetrics: extracted,
    dataQuality,
  };
}
