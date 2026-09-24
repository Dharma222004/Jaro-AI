import type { CompanyIdentity } from '@/types/company';
import type {
  ResearchReport,
  ResearchSourceMeta,
  BusinessSegment,
  DevelopmentItem,
  RiskItem,
  CommentaryItem,
} from '@/types/research';
import type { ValidationOutput } from './validator-engine';
import { analyzeWithGroq } from './groq-runner';

export async function generateInstitutionalAnalysis(params: {
  company: CompanyIdentity;
  query: string;
  validationOutput: ValidationOutput;
  segmentText: string;
  newsText: string;
  commentaryText: string;
  riskText: string;
  sources: ResearchSourceMeta[];
  generatedAt: string;
}): Promise<ResearchReport> {
  const {
    company,
    query,
    validationOutput,
    segmentText,
    newsText,
    commentaryText,
    riskText,
    sources,
    generatedAt,
  } = params;

  const { validatedMetrics, dataQuality } = validationOutput;

  // Build condensed, high-density evidence for Groq
  const metricsSummary = `
- Company: ${company.name} (${company.exchange}: ${company.ticker})
- Sector: ${company.sector ?? 'N/A'}, Industry: ${company.industry ?? 'N/A'}
- Reporting Basis: ${validatedMetrics.basis}
- Market Cap: ${validatedMetrics.marketCap?.value ? `₹${validatedMetrics.marketCap.value} Cr` : 'N/A'}
- Stock P/E: ${validatedMetrics.pe?.value ?? 'N/A'}, P/B: ${validatedMetrics.pb?.value ?? 'N/A'}
- Return on Equity (ROE): ${validatedMetrics.roe?.value ? `${validatedMetrics.roe.value}%` : 'N/A'}
- Return on Capital Employed (ROCE): ${validatedMetrics.roce?.value ? `${validatedMetrics.roce.value}%` : 'N/A'}
- Total Debt: ${validatedMetrics.totalDebt?.value ? `₹${validatedMetrics.totalDebt.value} Cr` : 'N/A'}
- Cash & Equivalents: ${validatedMetrics.cash?.value ? `₹${validatedMetrics.cash.value} Cr` : 'N/A'}
- Net Debt: ${validatedMetrics.netDebt?.value ? `₹${validatedMetrics.netDebt.value} Cr` : 'N/A'}
- Debt to Equity: ${validatedMetrics.debtToEquity?.value ?? 'N/A'}
- Latest Quarterly Revenue: ${validatedMetrics.revenue?.value ? `₹${validatedMetrics.revenue.value} Cr (${validatedMetrics.revenue.period})` : 'N/A'}
- Latest Net Profit (PAT): ${validatedMetrics.netProfit?.value ? `₹${validatedMetrics.netProfit.value} Cr (${validatedMetrics.netProfit.period})` : 'N/A'}
- EBITDA Margin: ${validatedMetrics.ebitdaMargin?.value ? `${validatedMetrics.ebitdaMargin.value}%` : 'N/A'}
- Net Margin: ${validatedMetrics.netMargin?.value ? `${validatedMetrics.netMargin.value}%` : 'N/A'}
- Shareholding: Promoter: ${validatedMetrics.promoterHolding?.value ?? 'N/A'}%, FII: ${validatedMetrics.fiiHolding?.value ?? 'N/A'}%, DII: ${validatedMetrics.diiHolding?.value ?? 'N/A'}%, Public: ${validatedMetrics.publicHolding?.value ?? 'N/A'}%, Pledged: ${validatedMetrics.pledgedHolding?.value ?? 0}%
  `.trim();

  // Source index reference
  const sourcesIndex = sources
    .slice(0, 10)
    .map((s) => `[${s.id}] ${s.title} (${s.domain}) - ${s.sourceType}`)
    .join('\n');

  const systemPrompt = `You are Jaro AI, an institutional equity research analyst specializing in Indian listed companies.
Your role is to synthesize the provided financial metrics and qualitative disclosures into a structured, evidence-based research report.

STRICT PRINCIPLES:
1. Ground every claim strictly in the provided evidence. Never fabricate numbers, facts, sources, or events.
2. Maintain an institutional, objective tone. Do NOT provide generic "Strong Buy / Hold / Sell" advice.
3. Clearly distinguish reported facts from analytical synthesis. Never treat management projections as guaranteed outcomes.
4. QUOTATION GUARDRAIL: Only use direct quotation marks when the retrieved source contains the actual statement. Otherwise use: "Management indicated that...". Never invent quotes.
5. Categorize risks specifically into: Business Risk, Industry Risk, Commodity Risk, Regulatory Risk, Financial Risk, Execution Risk, Competitive Risk. Each must include whyItMatters and concrete evidence.
6. Separate Current Growth Drivers from Potential Future Catalysts.
7. Provide a 5 to 8 sentence Executive Research Summary covering: business model, current earnings trajectory, key growth drivers, balance sheet posture, valuation context, and main risks.

Return ONLY a valid JSON object matching the requested schema.`;

  const userPrompt = `Research Query: "${query}"
Company: ${company.name} (${company.exchange}: ${company.ticker})
Date: ${generatedAt}

=== VERIFIED FINANCIAL METRICS ===
${metricsSummary}

=== SEGMENT & BUSINESS EVIDENCE ===
${segmentText.slice(0, 2000) || 'Diversified operations across core segments.'}

=== CORPORATE DEVELOPMENTS, CAPEX & ORDERS ===
${newsText.slice(0, 2000) || 'Recent corporate initiatives and operational milestones.'}

=== MANAGEMENT COMMENTARY & CONCALL ===
${commentaryText.slice(0, 1500) || 'Management remarks from recent quarterly investor interactions.'}

=== RISKS & CHALLENGES ===
${riskText.slice(0, 1500) || 'Sector headwinds, raw material price fluctuations, and regulatory compliance.'}

=== AVAILABLE SOURCES ===
${sourcesIndex}

Generate the institutional equity analysis JSON with this exact schema:
{
  "description": "2-3 sentence overview of business and core operations",
  "businessModel": "Clear explanation of revenue generation mechanics and monetization",
  "products": ["Key product 1", "Key product 2", "Key product 3"],
  "segments": [
    { "name": "Segment Name", "description": "Activities", "revenueShare": "e.g. 45% or null" }
  ],
  "geographies": ["India", "Global / Export markets"],
  "executiveSummary": "5-8 sentence institutional synthesis of business, financial health, growth drivers, valuation, and risks",
  "growthDrivers": ["Current structural driver 1", "Current structural driver 2"],
  "futureCatalysts": ["Potential future catalyst 1", "Potential future catalyst 2"],
  "strengths": ["Business strength 1", "Business strength 2", "Business strength 3"],
  "risks": [
    {
      "category": "Business Risk | Financial Risk | Industry Risk | Regulatory Risk | Execution Risk | Commodity Risk | Competitive Risk",
      "risk": "Short title",
      "description": "Explanation",
      "whyItMatters": "Financial / strategic impact",
      "evidence": "Supporting context",
      "severity": "high | medium | low",
      "sourceId": "e.g. src_1"
    }
  ],
  "managementCommentary": [
    {
      "speaker": "Executive name or management",
      "quote": "Key strategic statement or guidance",
      "context": "Earnings call / annual report",
      "date": "Period or year",
      "sourceId": "e.g. src_2"
    }
  ],
  "recentDevelopments": [
    {
      "headline": "Title of event",
      "whatHappened": "Summary of development",
      "whyItMatters": "Strategic implication",
      "date": "Date or period",
      "category": "Order Win | Expansion | Results | Acquisition | Regulatory",
      "sourceId": "e.g. src_1"
    }
  ],
  "balanceSheetAnalysis": "2-3 sentences on debt profile, leverage, and cash buffer",
  "cashFlowAnalysis": "2-3 sentences on capital intensity, capex cycle, and cash generation"
}`;

  let aiSynthesis: Record<string, any> = {};
  try {
    aiSynthesis = await analyzeWithGroq({ systemPrompt, userPrompt });
  } catch (err) {
    console.warn('[groq-analyzer] LLM synthesis failed, using fallback synthesis:', err);
    aiSynthesis = {
      description: `${company.name} (${company.exchange}: ${company.ticker}) is an Indian listed enterprise in the ${company.sector ?? 'equity market'} sector.`,
      businessModel: `Generates revenue through primary commercial operations in ${company.industry ?? 'its core domain'}.`,
      products: ['Core operations and services'],
      segments: [{ name: 'Primary Business', description: 'Core operational activities' }],
      geographies: ['Domestic (India)'],
      executiveSummary: `${company.name} operates in the ${company.sector ?? 'Indian corporate'} sector. Financial ratios indicate reported revenue of ₹${validatedMetrics.revenue?.value ?? 'N/A'} Cr with operating margins reflecting current industry conditions. Key monitoring areas include capital allocation, debt management, and demand trends across primary markets.`,
      growthDrivers: ['Industry expansion', 'Operational execution'],
      strengths: ['Established market presence in India'],
      risks: [
        {
          category: 'Industry Risk',
          risk: 'Macroeconomic & Sector Headwinds',
          description: 'Exposure to cyclical industry demand and input cost volatility.',
          whyItMatters: 'Can impact margin stability and earnings predictability.',
          severity: 'medium',
        },
      ],
      managementCommentary: [],
      recentDevelopments: [],
    };
  }

  // Map report sources into schema-compliant ReportSource[]
  const mappedSources = sources.map((s, idx) => ({
    id: s.id ?? `src_${idx + 1}`,
    url: s.url,
    title: s.title,
    domain: s.domain,
    sourceType: s.sourceType,
    authority: s.authority,
    publishedAt: s.publishedAt ?? null,
  }));

  // Map developments to ensure all fields are populated
  const recentDevelopments: DevelopmentItem[] = Array.isArray(aiSynthesis.recentDevelopments)
    ? aiSynthesis.recentDevelopments.map((d: any) => ({
        headline: d.headline || 'Corporate Update',
        description: d.whatHappened || d.description || '',
        whatHappened: d.whatHappened || d.description || '',
        whyItMatters: d.whyItMatters || '',
        date: d.date || null,
        sourceId: d.sourceId || mappedSources[0]?.id || null,
        category: d.category || 'General',
      }))
    : [];

  // Map risks to ensure all fields are populated
  const risks: RiskItem[] = Array.isArray(aiSynthesis.risks)
    ? aiSynthesis.risks.map((r: any) => ({
        category: r.category || 'Business Risk',
        risk: r.risk || r.category || 'Operational Risk',
        description: r.description || '',
        whyItMatters: r.whyItMatters || '',
        evidence: r.evidence || '',
        severity: (['high', 'medium', 'low'].includes(r.severity) ? r.severity : 'medium') as 'high' | 'medium' | 'low',
        sourceId: r.sourceId || null,
      }))
    : [];

  // Map management commentary
  const managementCommentary: CommentaryItem[] = Array.isArray(aiSynthesis.managementCommentary)
    ? aiSynthesis.managementCommentary.map((c: any) => ({
        speaker: c.speaker || 'Management',
        quote: c.quote || '',
        context: c.context || 'Investor Disclosure',
        date: c.date || null,
        sourceId: c.sourceId || null,
      }))
    : [];

  // Assemble full institutional ResearchReport
  const report: ResearchReport = {
    company: {
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      isin: company.isin,
      sector: company.sector ?? 'General',
      industry: company.industry ?? 'Equity',
      description: aiSynthesis.description || `${company.name} is a leading Indian listed company.`,
      marketCap: validatedMetrics.marketCap,
    },
    business: {
      businessModel: aiSynthesis.businessModel || 'Monetization through core products and services.',
      products: Array.isArray(aiSynthesis.products) ? aiSynthesis.products : ['Core Offerings'],
      segments: Array.isArray(aiSynthesis.segments) ? aiSynthesis.segments : [{ name: 'Core Operations' }],
      geographies: Array.isArray(aiSynthesis.geographies) ? aiSynthesis.geographies : ['India'],
    },
    financials: {
      revenue: validatedMetrics.revenue ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      ebitda: validatedMetrics.ebitda ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      profit: validatedMetrics.netProfit ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      eps: validatedMetrics.eps ?? { value: null, unit: '₹', period: null, basis: validatedMetrics.basis },
      debt: validatedMetrics.totalDebt ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      cash: validatedMetrics.cash ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      cashFlow: { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis, note: 'Detailed cash flow statement not fully disclosed in quarterly summary.' },
      revenueGrowth: validatedMetrics.revenueGrowth,
      profitGrowth: validatedMetrics.profitGrowth,
      netDebt: validatedMetrics.netDebt,
      debtToEquity: validatedMetrics.debtToEquity,
    },
    profitability: {
      roe: validatedMetrics.roe ?? { value: null, unit: '%', period: null, basis: validatedMetrics.basis },
      roce: validatedMetrics.roce ?? { value: null, unit: '%', period: null, basis: validatedMetrics.basis },
      netMargin: validatedMetrics.netMargin ?? { value: null, unit: '%', period: null, basis: validatedMetrics.basis },
      ebitdaMargin: validatedMetrics.ebitdaMargin,
    },
    valuation: {
      pe: validatedMetrics.pe ?? { value: null, unit: 'x', period: null, basis: validatedMetrics.basis },
      pb: validatedMetrics.pb ?? { value: null, unit: 'x', period: null, basis: validatedMetrics.basis },
      marketCap: validatedMetrics.marketCap ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      dividendYield: validatedMetrics.dividendYield,
    },
    shareholding: {
      promoter: validatedMetrics.promoterHolding ?? { value: null, unit: '%', period: null },
      fii: validatedMetrics.fiiHolding ?? { value: null, unit: '%', period: null },
      dii: validatedMetrics.diiHolding ?? { value: null, unit: '%', period: null },
      public: validatedMetrics.publicHolding ?? { value: null, unit: '%', period: null },
      pledged: validatedMetrics.pledgedHolding ?? { value: 0, unit: '%', period: null },
      asOfDate: validatedMetrics.shareholdingAsOf ?? null,
    },
    balanceSheetAnalysis: aiSynthesis.balanceSheetAnalysis || undefined,
    cashFlowAnalysis: aiSynthesis.cashFlowAnalysis || undefined,
    segmentAnalysis: Array.isArray(aiSynthesis.segments) ? aiSynthesis.segments : undefined,
    recentDevelopments,
    growthDrivers: Array.isArray(aiSynthesis.growthDrivers) ? aiSynthesis.growthDrivers : [],
    futureCatalysts: Array.isArray(aiSynthesis.futureCatalysts) ? aiSynthesis.futureCatalysts : [],
    strengths: Array.isArray(aiSynthesis.strengths) ? aiSynthesis.strengths : [],
    risks,
    managementCommentary,
    technicalAnalysis: validatedMetrics.technical,
    dataQuality,
    researchSummary: aiSynthesis.executiveSummary || `${company.name} fundamental research synthesis.`,
    sources: mappedSources,
    generatedAt,
    queryAsked: query,
    basisPreference: validatedMetrics.basis,
  };

  return report;
}
