import type { ExplainableScore, ScoreFactor, ScoreMetricDetail } from '@/types/decision';
import type { ResearchReport, FinancialMetric } from '@/types/research';
import type { TechnicalAnalysisResult } from '@/types/technical';

export function scoreFundamentals(report: ResearchReport): ExplainableScore {
  const financialSector = /bank|financial|nbfc|insurance/i.test(`${report.company.sector} ${report.company.industry}`);
  const factors: ScoreFactor[] = financialSector
    ? [
        growthFactor('Revenue growth', report.financials.revenueGrowth, 22, -5, 18),
        growthFactor('Profit growth', report.financials.profitGrowth, 22, -5, 20),
        highFactor('Return on equity', report.profitability.roe, 22, 8, 20),
        highFactor('Net margin', report.profitability.netMargin, 14, 5, 20),
        highFactor('Promoter holding', report.shareholding.promoter, 10, 20, 60),
        highFactor('Institutional ownership', combineMetrics(report.shareholding.fii, report.shareholding.dii), 10, 5, 35),
      ]
    : [
        growthFactor('Revenue growth', report.financials.revenueGrowth, 17, -5, 20),
        growthFactor('Profit growth', report.financials.profitGrowth, 17, -5, 25),
        highFactor('ROE', report.profitability.roe, 14, 8, 22),
        highFactor('ROCE', report.profitability.roce, 17, 8, 25),
        lowFactor('Debt to equity', report.financials.debtToEquity, 13, 1.5, 0.1),
        highFactor('Net margin', report.profitability.netMargin, 9, 4, 20),
        cashFlowFactor(report, 7),
        lowFactor('Promoter pledge', report.shareholding.pledged, 6, 25, 0),
      ];
  return aggregateScore(
    'Fundamentals',
    factors,
    'Growth, returns, balance sheet leverage and cash generation',
    financialSector
      ? 'Sector-aware financial services framework: credit growth, net interest margin, ROE and institutional ownership.'
      : 'Non-financial framework: revenue growth, earnings growth, ROE, ROCE, debt leverage, net margins, cash flow and promoter pledging.',
    financialSector
      ? 'Sector-aware financial-services framework: growth, ROE, margin and ownership. Corporate debt/equity is excluded because it is not comparable for lenders.'
      : 'Non-financial framework: growth, return ratios, leverage, margins, cash generation and promoter pledge. Missing metrics are excluded rather than guessed.',
  );
}

export function scoreValuation(report: ResearchReport): ExplainableScore {
  const financialSector = /bank|financial|nbfc|insurance/i.test(`${report.company.sector} ${report.company.industry}`);
  const factors: ScoreFactor[] = [
    lowFactor('P/E', report.valuation.pe, financialSector ? 45 : 40, financialSector ? 35 : 45, financialSector ? 10 : 12),
    lowFactor('P/B', report.valuation.pb, financialSector ? 45 : 25, financialSector ? 6 : 8, financialSector ? 1 : 1.5),
    lowFactor('EV/EBITDA', report.valuation.evEbitda, financialSector ? 0 : 25, 30, 8),
    highFactor('Dividend yield', report.valuation.dividendYield, financialSector ? 10 : 10, 0, 4),
  ].filter((factor) => factor.weight > 0);
  return aggregateScore(
    'Valuation',
    factors,
    'Available historical and relative valuation multiples',
    'Relative valuation proxy analyzing P/E, P/B, EV/EBITDA, and dividend yield against standard institutional valuation bands.',
    'Relative-attractiveness proxy using available valuation multiples. It is not an intrinsic-value estimate and should be compared with the company’s own history and peers.',
  );
}

export function scoreTechnicals(primary: TechnicalAnalysisResult, confirmation?: TechnicalAnalysisResult): ExplainableScore {
  const p = primary.indicators;
  const latest = primary.candles.at(-1)?.close ?? null;
  const factors: ScoreFactor[] = [
    categoricalFactor('Primary trend', primary.trend === 'bullish' ? 90 : primary.trend === 'sideways' ? 50 : primary.trend === 'bearish' ? 15 : null, 24, `${primary.timeframe}: ${primary.trend}`),
    categoricalFactor('Higher-timeframe trend', confirmation ? confirmation.trend === 'bullish' ? 90 : confirmation.trend === 'sideways' ? 50 : confirmation.trend === 'bearish' ? 15 : null : null, 22, confirmation ? `${confirmation.timeframe}: ${confirmation.trend}` : 'Not available'),
    categoricalFactor('EMA alignment', latest == null || p.ema20 == null || p.ema50 == null || p.ema200 == null ? null : latest > p.ema20 && p.ema20 > p.ema50 && p.ema50 > p.ema200 ? 95 : latest < p.ema20 && p.ema20 < p.ema50 && p.ema50 < p.ema200 ? 10 : 50, 18, `Close ${fmt(latest)}; EMA20 ${fmt(p.ema20)}, EMA50 ${fmt(p.ema50)}, EMA200 ${fmt(p.ema200)}`),
    bandFactor('RSI condition', p.rsi14, 14, 45, 65, 30, 75),
    categoricalFactor('MACD momentum', p.macdHistogram == null ? null : p.macdHistogram > 0 ? 80 : 25, 10, `Histogram ${fmt(p.macdHistogram)}`),
    highFactorRaw('ADX trend strength', p.adx14, 7, 12, 30),
    highFactorRaw('Relative volume', p.relativeVolume, 5, 0.7, 1.8),
  ];
  return aggregateScore(
    'Technical',
    factors,
    'Trend structure, moving averages, momentum and volume',
    `Multi-timeframe technical posture (${primary.timeframe}: ${primary.trend}): moving-average hierarchy, RSI condition, MACD momentum and volume confirmation.`,
    'Multi-timeframe technical score combining trend, moving-average alignment, momentum, trend strength and volume. No single indicator determines the score.',
  );
}

export function scoreRisk(report: ResearchReport, primary: TechnicalAnalysisResult): ExplainableScore {
  const highRisks = report.risks.filter((risk) => risk.severity === 'high').length;
  const mediumRisks = report.risks.filter((risk) => risk.severity === 'medium').length;
  const atrPct = primary.indicators.atrPct;
  const pledge = metricNumber(report.shareholding.pledged);
  const debt = metricNumber(report.financials.debtToEquity);
  const factors: ScoreFactor[] = [
    categoricalFactor('Disclosed risk burden', Math.max(0, 100 - highRisks * 28 - mediumRisks * 10), 35, `${highRisks} high and ${mediumRisks} medium severity risks in retrieved evidence`),
    categoricalFactor('Price volatility', atrPct == null ? null : atrPct <= 2 ? 90 : atrPct <= 3.5 ? 70 : atrPct <= 5 ? 45 : 20, 25, `ATR is ${fmt(atrPct)}% of price`),
    lowFactorRaw('Promoter pledge', pledge, 20, 25, 0),
    /bank|financial|nbfc|insurance/i.test(`${report.company.sector} ${report.company.industry}`)
      ? categoricalFactor('Leverage comparability', null, 20, 'Corporate debt/equity omitted for financial companies')
      : lowFactorRaw('Debt to equity', debt, 20, 1.5, 0.1),
  ];
  return aggregateScore(
    'Risk Resilience',
    factors,
    'Financial volatility, balance sheet risk and operational disclosure',
    'Composite balance-sheet risk resilience, price volatility (ATR), promoter share pledging and severity of disclosed regulatory and operational risks.',
    'Higher values indicate greater observed resilience/lower measured risk—not certainty. Event, governance and gap risks can remain outside measured fields.',
  );
}

export function metricNumber(metric?: FinancialMetric | null): number | null {
  if (!metric || metric.value == null || metric.value === '') return null;
  const value = typeof metric.value === 'number' ? metric.value : Number(String(metric.value).replace(/,/g, '').replace(/%|x/g, ''));
  return Number.isFinite(value) ? value : null;
}

function growthFactor(name: string, metric: FinancialMetric | undefined, weight: number, poor: number, strong: number): ScoreFactor {
  return highFactor(name, metric, weight, poor, strong);
}
function highFactor(name: string, metric: FinancialMetric | undefined, weight: number, poor: number, strong: number): ScoreFactor {
  return { name, score: scale(metricNumber(metric), poor, strong), weight, evidence: metricEvidence(metric), period: metric?.period, sourceId: metric?.sourceId };
}
function lowFactor(name: string, metric: FinancialMetric | undefined, weight: number, poor: number, strong: number): ScoreFactor {
  return { name, score: inverseScale(metricNumber(metric), strong, poor), weight, evidence: metricEvidence(metric), period: metric?.period, sourceId: metric?.sourceId };
}
function highFactorRaw(name: string, value: number | null, weight: number, poor: number, strong: number): ScoreFactor {
  return { name, score: scale(value, poor, strong), weight, evidence: fmt(value) };
}
function lowFactorRaw(name: string, value: number | null, weight: number, poor: number, strong: number): ScoreFactor {
  return { name, score: inverseScale(value, strong, poor), weight, evidence: fmt(value) };
}
function bandFactor(name: string, value: number | null, weight: number, idealLow: number, idealHigh: number, extremeLow: number, extremeHigh: number): ScoreFactor {
  let score: number | null = null;
  if (value != null) score = value >= idealLow && value <= idealHigh ? 90 : value < extremeLow || value > extremeHigh ? 25 : 60;
  return { name, score, weight, evidence: fmt(value) };
}
function categoricalFactor(name: string, score: number | null, weight: number, evidence: string): ScoreFactor {
  return { name, score, weight, evidence };
}
function cashFlowFactor(report: ResearchReport, weight: number): ScoreFactor {
  const value = metricNumber(report.financials.freeCashFlow) ?? metricNumber(report.financials.cashFlow);
  return { name: 'Cash-flow generation', score: value == null ? null : value > 0 ? 80 : 20, weight, evidence: value == null ? 'Unavailable' : `${value} ${report.financials.freeCashFlow?.unit ?? report.financials.cashFlow.unit}`, period: report.financials.freeCashFlow?.period ?? report.financials.cashFlow.period };
}
function combineMetrics(a?: FinancialMetric, b?: FinancialMetric): FinancialMetric | undefined {
  const av = metricNumber(a); const bv = metricNumber(b);
  if (av == null && bv == null) return undefined;
  return { value: (av ?? 0) + (bv ?? 0), unit: '%', period: a?.period ?? b?.period, sourceId: a?.sourceId ?? b?.sourceId };
}

function aggregateScore(
  category: string,
  factors: ScoreFactor[],
  summary: string,
  explanation: string,
  methodology: string,
): ExplainableScore {
  const available = factors.filter((factor) => factor.score != null);
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const availableWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  const score = availableWeight ? available.reduce((sum, factor) => sum + factor.score! * factor.weight, 0) / availableWeight : null;
  const rounded = score == null ? null : Math.round(score);
  const coverage = totalWeight ? Math.round((availableWeight / totalWeight) * 100) : 0;
  const label = scoreLabel(rounded, coverage);

  const supportingMetrics: ScoreMetricDetail[] = factors.map((factor) => ({
    name: factor.name,
    value: factor.evidence || 'N/A',
    status: factor.score != null ? 'verified' : 'unavailable',
    weight: factor.weight,
    score: factor.score,
  }));

  const missingData = factors.filter((f) => f.score == null).map((f) => f.name);

  return {
    category,
    score: rounded,
    maxScore: 100,
    coveragePct: coverage,
    dataCoverage: coverage,
    status: label,
    label,
    summary,
    explanation,
    methodology,
    supportingMetrics,
    missingData,
    methodologyVersion: 'v2.4-institutional',
    calculationTimestamp: new Date().toISOString(),
    factors,
  };
}

function scale(value: number | null, poor: number, strong: number) { return value == null ? null : Math.max(0, Math.min(100, ((value - poor) / (strong - poor)) * 100)); }
function inverseScale(value: number | null, strong: number, poor: number) { return value == null ? null : Math.max(0, Math.min(100, ((poor - value) / (poor - strong)) * 100)); }
function scoreLabel(score: number | null, coverage: number): ExplainableScore['label'] {
  if (score == null || coverage < 25) return 'Insufficient data';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Acceptable';
  if (score >= 40) return 'Mixed';
  return 'Weak';
}
function metricEvidence(metric?: FinancialMetric) { return metricNumber(metric) == null ? 'Unavailable' : `${metric!.value}${metric!.unit ? ` ${metric!.unit}` : ''}`; }
function fmt(value: number | null) { return value == null ? 'N/A' : value.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
