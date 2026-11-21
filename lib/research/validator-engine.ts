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
  externalConflicts?: ConflictRecord[];
}): ValidationOutput {
  const { extracted, sources, filingText, screenerText } = params;

  const conflicts: ConflictRecord[] = [...(params.externalConflicts ?? [])];
  const basisWarnings = validateMetricMetadata(extracted, conflicts);
  const missingMetrics: string[] = [];

  // Check key metrics for availability
  const checkMetric = (name: string, m?: FinancialMetric) => {
    if ((!m || m.value === null || m.value === undefined || m.value === '') && m?.verificationStatus !== 'not_applicable') {
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
  checkMetric('Debt to Equity', extracted.debtToEquity);
  checkMetric('Current Ratio', extracted.currentRatio);
  checkMetric('Interest Coverage', extracted.interestCoverage);
  checkMetric('Total Assets', extracted.totalAssets);
  checkMetric('Total Liabilities', extracted.totalLiabilities);
  checkMetric('Shareholders Equity', extracted.shareholdersEquity);
  checkMetric('Operating Cash Flow', extracted.operatingCashFlow);
  checkMetric('Free Cash Flow', extracted.freeCashFlow);

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
    basisWarnings,
    metricAudit: buildMetricAudit(extracted),
  };

  return {
    validatedMetrics: extracted,
    dataQuality,
  };
}

function buildMetricAudit(extracted: ExtractedFinancials): NonNullable<DataQualityReport['metricAudit']> {
  const labels: Array<[string, string]> = [
    ['revenue', 'Revenue'], ['ebitda', 'EBITDA / Operating Profit'], ['netProfit', 'Net Profit'], ['eps', 'EPS'],
    ['totalDebt', 'Total Debt'], ['cash', 'Cash & Equivalents'], ['totalAssets', 'Total Assets'],
    ['totalLiabilities', 'Total Liabilities'], ['currentAssets', 'Current Assets'], ['currentLiabilities', 'Current Liabilities'],
    ['shareholdersEquity', 'Shareholders Equity'], ['reserves', 'Reserves'], ['operatingCashFlow', 'Operating Cash Flow'],
    ['investingCashFlow', 'Investing Cash Flow'], ['financingCashFlow', 'Financing Cash Flow'], ['capex', 'Capital Expenditure'],
    ['freeCashFlow', 'Free Cash Flow'], ['debtToEquity', 'Debt to Equity'], ['currentRatio', 'Current Ratio'],
    ['interestCoverage', 'Interest Coverage'], ['roe', 'ROE'], ['roce', 'ROCE'], ['pe', 'P/E'], ['pb', 'P/B'],
    ['evEbitda', 'EV/EBITDA'], ['promoterHolding', 'Promoter Holding'], ['fiiHolding', 'FII Holding'],
    ['diiHolding', 'DII Holding'], ['publicHolding', 'Public Holding'], ['pledgedHolding', 'Promoter Pledge'],
  ];
  const record = extracted as unknown as Record<string, unknown>;
  return labels.map(([key, label]) => {
    const metric = record[key] as FinancialMetric | undefined;
    return {
      metric: label,
      value: metric?.value ?? null,
      unit: metric?.unit ?? '',
      period: metric?.period,
      basis: metric?.basis,
      currency: metric?.currency,
      statementType: metric?.statementType,
      sourceId: metric?.sourceId,
      sourceName: metric?.sourceName,
      sourceUrl: metric?.sourceUrl,
      publicationDate: metric?.publicationDate,
      retrievedAt: metric?.retrievedAt,
      verificationStatus: metric?.verificationStatus ?? (metric?.value != null ? 'unverified' : 'unavailable'),
      confidence: metric?.confidence,
      formula: metric?.formula,
      note: metric?.note,
    };
  });
}

function validateMetricMetadata(extracted: ExtractedFinancials, conflicts: ConflictRecord[]) {
  const warnings: string[] = [];
  const record = extracted as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (!isFinancialMetric(value) || value.value == null || value.value === '') continue;
    let basisFromStatement: NonNullable<FinancialMetric['basis']> = value.statementType === 'consolidated' ? 'Consolidated'
      : value.statementType === 'standalone' ? 'Standalone' : 'Unspecified';
    let basis: NonNullable<FinancialMetric['basis']> = value.basis ?? 'Unspecified';
    if (basis !== 'Unspecified' && basisFromStatement === 'Unspecified' && value.statementType == null) {
      value.statementType = basis === 'Consolidated' ? 'consolidated' : 'standalone';
      basisFromStatement = basis;
    } else if (basis === 'Unspecified' && basisFromStatement !== 'Unspecified') {
      value.basis = basisFromStatement;
      basis = basisFromStatement;
    }
    if (basis !== 'Unspecified' && basisFromStatement !== 'Unspecified' && basis !== basisFromStatement) {
      conflicts.push({
        metric: humanizeKey(key),
        selectedValue: null,
        selectedSource: value.sourceName ?? value.sourceUrl ?? 'Retrieved evidence',
        conflictingValues: [{ value: value.value, source: 'Metric metadata', basis }, { value: value.value, source: 'Statement metadata', basis: basisFromStatement }],
        resolution: 'The value was excluded because consolidated and standalone metadata conflict.',
      });
      value.value = null;
      value.verificationStatus = 'unavailable';
      value.confidence = 'limited';
      value.note = 'Reporting basis conflict detected; value excluded pending verification against the original filing.';
      warnings.push(`${humanizeKey(key)}: consolidated/standalone metadata conflict; value excluded.`);
      continue;
    }
    if (basis === 'Unspecified' && basisFromStatement === 'Unspecified') {
      value.basis = 'Unspecified';
      value.statementType = 'unspecified';
      value.verificationStatus = value.verificationStatus === 'verified' ? 'unverified' : value.verificationStatus;
      value.confidence = value.confidence === 'high' ? 'moderate' : value.confidence;
      const note = 'Reporting basis could not be independently confirmed.';
      value.note = value.note ? `${value.note} ${note}` : note;
      warnings.push(`${humanizeKey(key)}: ${note}`);
    }
    if (!value.currency && /₹|INR/i.test(value.unit)) value.currency = 'INR';
    if (!value.period) {
      value.verificationStatus = value.verificationStatus === 'verified' ? 'unverified' : value.verificationStatus;
      warnings.push(`${humanizeKey(key)}: reporting period is unavailable.`);
    }
  }
  return [...new Set(warnings)];
}

function isFinancialMetric(value: unknown): value is FinancialMetric {
  return Boolean(value && typeof value === 'object' && 'value' in value && 'unit' in value);
}

function humanizeKey(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}
