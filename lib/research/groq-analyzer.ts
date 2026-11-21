import type { CompanyIdentity } from '@/types/company';
import type {
  ResearchReport,
  ResearchSourceMeta,
  DevelopmentItem,
  RiskItem,
  CommentaryItem,
  AnalystVerdict,
} from '@/types/research';
import type { ValidationOutput } from './validator-engine';
import { analyzeWithGroq } from '@/lib/groq/client';

interface AnalysisSynthesis {
  description?: string;
  businessModel?: string;
  products?: string[];
  segments?: BusinessSegment[];
  geographies?: string[];
  executiveSummary?: string;
  growthDrivers?: string[];
  futureCatalysts?: string[];
  strengths?: string[];
  risks?: unknown[];
  managementCommentary?: unknown[];
  recentDevelopments?: unknown[];
  balanceSheetAnalysis?: string;
  cashFlowAnalysis?: string;
}

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
- Total Assets: ${validatedMetrics.totalAssets?.value ? `₹${validatedMetrics.totalAssets.value} Cr (${validatedMetrics.totalAssets.period})` : 'N/A'}
- Shareholders Equity: ${validatedMetrics.shareholdersEquity?.value ? `₹${validatedMetrics.shareholdersEquity.value} Cr (${validatedMetrics.shareholdersEquity.period})` : 'N/A'}
- Current Ratio: ${validatedMetrics.currentRatio?.value ?? 'N/A'}
- Interest Coverage: ${validatedMetrics.interestCoverage?.value ?? 'N/A'}
- Operating Cash Flow: ${validatedMetrics.operatingCashFlow?.value ? `₹${validatedMetrics.operatingCashFlow.value} Cr (${validatedMetrics.operatingCashFlow.period})` : 'N/A'}
- Free Cash Flow: ${validatedMetrics.freeCashFlow?.value ? `₹${validatedMetrics.freeCashFlow.value} Cr (${validatedMetrics.freeCashFlow.period})` : 'N/A'}
- Latest Quarterly Revenue: ${validatedMetrics.revenue?.value ? `₹${validatedMetrics.revenue.value} Cr (${validatedMetrics.revenue.period})` : 'N/A'}
- Latest Net Profit (PAT): ${validatedMetrics.netProfit?.value ? `₹${validatedMetrics.netProfit.value} Cr (${validatedMetrics.netProfit.period})` : 'N/A'}
- EBITDA Margin: ${validatedMetrics.ebitdaMargin?.value ? `${validatedMetrics.ebitdaMargin.value}%` : 'N/A'}
- Net Margin: ${validatedMetrics.netMargin?.value ? `${validatedMetrics.netMargin.value}%` : 'N/A'}
- Shareholding: Promoter: ${validatedMetrics.promoterHolding?.value ?? 'N/A'}%, FII: ${validatedMetrics.fiiHolding?.value ?? 'N/A'}%, DII: ${validatedMetrics.diiHolding?.value ?? 'N/A'}%, Public: ${validatedMetrics.publicHolding?.value ?? 'N/A'}%, Pledged: ${validatedMetrics.pledgedHolding?.value ?? 0}%
  `.trim();

  const sourcesIndex = sources
    .slice(0, 12)
    .map((s) => `[${s.id}] ${s.title} (${s.domain}) - ${s.sourceType}`)
    .join('\n');

  const systemPrompt = `You are Jaro AI, a Senior Institutional Equity Research Analyst specializing in Indian & global listed companies.
Your role is to perform deep stock research combining:
1. Fundamental Valuation & Quality (ROE, ROCE, P/E, P/B, EV/EBITDA, Revenue/PAT trajectory, Balance Sheet & Cash Flows)
2. Institutional Analyst Verdict & Recommendation Framework (Consensus stance, conviction score 0-100, valuation comfort, bull case vs bear case, and a 6-factor fundamental scorecard)
3. Technical Structure & Price Action (50-DMA, 200-DMA, RSI, support & resistance zones, momentum signal, and trend)
4. Latest Corporate News, Order Book, Quarterly Concall Highlights & Categorized Risks
5. Simultaneous ChatGPT-style Direct Analyst Briefing ("initialChatbotReply") that directly answers the user's exact query ("${query}") in rich Markdown (with tables, bullet points, fundamental & technical breakdown, latest news, and clear analytical synthesis).

STRICT PRINCIPLES:
- Ground every claim in verified web search evidence and filings.
- If any fundamental or technical metric is missing from the pre-extracted summary, fill it in from your live Google Search results in the "extractedFinancialOverrides" and "technicalOverrides" fields!
- Return ONLY a valid JSON object matching the exact schema requested.`;

  const userPrompt = `User Query: "${query}"
Company: ${company.name} (${company.exchange}: ${company.ticker})
Date: ${generatedAt}

=== PRE-EXTRACTED FINANCIAL METRICS ===
${metricsSummary}

=== SEGMENT & BUSINESS EVIDENCE ===
${segmentText.slice(0, 2500) || 'Diversified operations across core segments.'}

=== CORPORATE DEVELOPMENTS, CAPEX & LATEST NEWS ===
${newsText.slice(0, 2500) || 'Recent corporate initiatives and operational milestones.'}

=== MANAGEMENT COMMENTARY & CONCALL ===
${commentaryText.slice(0, 1800) || 'Management remarks from recent quarterly investor interactions.'}

=== RISKS & CHALLENGES ===
${riskText.slice(0, 1800) || 'Sector headwinds, raw material price fluctuations, and regulatory compliance.'}

=== AVAILABLE SOURCES ===
${sourcesIndex}

Return ONLY valid JSON matching this schema:
{
  "description": "2-3 sentence institutional overview of business and market position",
  "businessModel": "Detailed explanation of revenue generation mechanics, pricing power, and monetization",
  "products": ["Key product/service 1", "Key product/service 2", "Key product/service 3"],
  "segments": [
    { "name": "Segment Name", "description": "Core activities and drivers", "revenueShare": "e.g. 48%" }
  ],
  "geographies": ["India (Domestic)", "International / Exports"],
  "executiveSummary": "6-8 sentence institutional synthesis covering business moat, latest quarterly earnings trajectory, return ratios (ROE/ROCE), balance sheet health, technical posture, valuation multiples, and key catalysts/risks",
  "analystVerdict": {
    "stance": "Bullish / Accumulate | Constructive / Outperform | Neutral / Hold | Cautious / Underperform",
    "convictionScore": 82,
    "valuationStatus": "Undervalued | Fairly Valued | Premium / Richly Valued",
    "fairValueRange": "e.g. ₹1,450 – ₹1,620 (12M Institutional Consensus)",
    "thesisSummary": "3-4 sentence core analyst recommendation thesis explaining why fundamentals, technicals, and catalysts support this stance",
    "bullCase": ["Bull case catalyst 1 with numbers", "Bull case catalyst 2", "Bull case catalyst 3"],
    "bearCase": ["Bear case risk 1 with impact", "Bear case risk 2", "Bear case risk 3"],
    "fundamentalScorecard": [
      { "factor": "Profitability & Return Ratios (ROE/ROCE)", "score": "Strong | Moderate | Weak", "verdict": "1-sentence justification" },
      { "factor": "Earnings & Revenue Growth Visibility", "score": "Strong | Moderate | Weak", "verdict": "1-sentence justification" },
      { "factor": "Balance Sheet & Leverage Profile", "score": "Strong | Moderate | Weak", "verdict": "1-sentence justification" },
      { "factor": "Valuation Comfort (P/E, P/B, EV/EBITDA)", "score": "Attractive | Fair | Expensive", "verdict": "1-sentence justification" },
      { "factor": "Technical Trend & Momentum", "score": "Bullish | Neutral | Bearish", "verdict": "1-sentence justification" },
      { "factor": "Institutional & Promoter Ownership", "score": "Strong | Moderate | Weak", "verdict": "1-sentence justification" }
    ]
  },
  "initialChatbotReply": "A comprehensive, ChatGPT-style Markdown response directly answering the user's query ('${query}'). Include: 1) Direct Executive Answer & Analyst Stance, 2) Markdown Table of Key Fundamentals & Valuation Multiples, 3) Technical Structure & Key Levels (Support/Resistance/DMA/RSI), 4) Latest News & Catalysts, and 5) Key Risks & Follow-up Prompts.",
  "extractedFinancialOverrides": {
    "marketCapCr": null,
    "pe": null,
    "pb": null,
    "evEbitda": null,
    "dividendYield": null,
    "roe": null,
    "roce": null,
    "revenueCr": null,
    "revenuePeriod": "Latest Quarter / TTM",
    "revenueGrowthPct": null,
    "ebitdaCr": null,
    "ebitdaMarginPct": null,
    "patCr": null,
    "patGrowthPct": null,
    "netMarginPct": null,
    "eps": null,
    "totalDebtCr": null,
    "cashCr": null,
    "debtToEquity": null,
    "promoterPct": null,
    "fiiPct": null,
    "diiPct": null,
    "publicPct": null
  },
  "technicalOverrides": {
    "price": null,
    "high52W": null,
    "low52W": null,
    "sma50": null,
    "sma200": null,
    "rsi": null,
    "trend": "Bullish | Neutral | Bearish",
    "momentumSignal": "e.g. Trading above 50-DMA & 200-DMA with neutral-to-positive RSI",
    "supportLevels": ["₹...", "₹..."],
    "resistanceLevels": ["₹...", "₹..."],
    "observations": "3-4 sentence technical structure commentary covering moving averages, RSI momentum, 52-week range positioning, and key support/resistance zones"
  },
  "growthDrivers": ["Current structural driver 1", "Current structural driver 2", "Current structural driver 3"],
  "futureCatalysts": ["Potential future catalyst 1", "Potential future catalyst 2", "Potential future catalyst 3"],
  "strengths": ["Business strength 1", "Business strength 2", "Business strength 3", "Business strength 4"],
  "risks": [
    {
      "category": "Business Risk | Financial Risk | Industry Risk | Regulatory Risk | Execution Risk | Commodity Risk | Competitive Risk",
      "risk": "Short title",
      "description": "Detailed explanation",
      "whyItMatters": "Financial / margin / strategic impact",
      "evidence": "Supporting context from filings/news",
      "severity": "high | medium | low",
      "sourceId": "src_1"
    }
  ],
  "managementCommentary": [
    {
      "speaker": "Management / Concall Guidance",
      "quote": "Key strategic statement or guidance from recent earnings call / report",
      "context": "Quarterly Earnings Call / Annual Report",
      "date": "FY2025-26",
      "sourceId": "src_2"
    }
  ],
  "recentDevelopments": [
    {
      "headline": "Title of event / news",
      "whatHappened": "Summary of development",
      "whyItMatters": "Strategic & financial implication",
      "date": "Recent Quarter / 2025-2026",
      "category": "Results | Order Win | Expansion | Acquisition | Regulatory",
      "sourceId": "src_1"
    }
  ],
  "balanceSheetAnalysis": "2-3 sentences on debt profile, leverage, working capital, and cash buffer",
  "cashFlowAnalysis": "2-3 sentences on operating cash flow conversion, capex intensity, and free cash flow generation"
}`;

  let aiSynthesis: AnalysisSynthesis = {};
  try {
    aiSynthesis = await analyzeWithGroq({ systemPrompt, userPrompt }) as unknown as AnalysisSynthesis;
  } catch (err) {
    console.warn('[nvidia-analyzer] LLM synthesis failed, using fallback synthesis:', err);
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

  if (!aiSynthesis || Object.keys(aiSynthesis).length === 0) {
    try {
      aiSynthesis = await analyzeWithGroq({ systemPrompt, userPrompt });
    } catch (err) {
      console.warn('[groq-analyzer] Groq synthesis also failed, using structured fallback:', err);
      aiSynthesis = {
        description: `${company.name} (${company.exchange}: ${company.ticker}) is a prominent listed enterprise in the ${company.sector ?? 'Indian equity'} sector.`,
        businessModel: `Generates revenue through primary commercial operations in ${company.industry ?? 'its core industry'}.`,
        products: ['Core products and institutional services'],
        segments: [{ name: 'Core Business Segment', description: 'Primary revenue-generating operations' }],
        geographies: ['India (Domestic)', 'Global Markets'],
        executiveSummary: `${company.name} operates as an established player in the ${company.sector ?? 'Indian corporate'} sector. Financial disclosures indicate a focus on operational efficiency, capital allocation discipline, and market share expansion across core segments.`,
        growthDrivers: ['Sectoral demand tailwinds', 'Operating leverage and capacity expansion'],
        strengths: ['Established market presence', 'Institutional coverage on NSE/BSE'],
        risks: [
          {
            category: 'Industry Risk',
            risk: 'Macroeconomic & Input Cost Volatility',
            description: 'Exposure to cyclical demand shifts and raw material cost fluctuations.',
            whyItMatters: 'Can impact operating margin stability and near-term earnings visibility.',
            severity: 'medium',
          },
        ],
        managementCommentary: [],
        recentDevelopments: [],
      };
    }
  }

  // Merge sources (deduplicated by URL)
  const combinedSourcesList: ResearchSourceMeta[] = [...sources];
  const seenUrls = new Set(sources.map((s) => s.url));
  for (const gs of extraGroundingSources) {
    if (!seenUrls.has(gs.url) && combinedSourcesList.length < 20) {
      seenUrls.add(gs.url);
      combinedSourcesList.push({
        ...gs,
        id: `src_${combinedSourcesList.length + 1}`,
      });
    }
  }

  const mappedSources = combinedSourcesList.map((s, idx) => ({
    id: s.id ?? `src_${idx + 1}`,
    url: s.url,
    title: s.title,
    domain: s.domain,
    sourceType: s.sourceType,
    authority: s.authority,
    publishedAt: s.publishedAt ?? null,
    retrievedAt: s.retrievedAt,
    supportedMetrics: s.supportedMetrics,
  }));

  const ov = aiSynthesis.extractedFinancialOverrides || {};
  const toMetric = (
    existing: ResearchReport['financials']['revenue'] | undefined,
    overrideVal: number | string | null | undefined,
    unit: string,
    period: string | null = ov.revenuePeriod || 'Latest'
  ) => {
    if (existing && existing.value !== null && existing.value !== undefined && existing.value !== '') {
      return existing;
    }
    if (overrideVal !== null && overrideVal !== undefined && overrideVal !== '') {
      return {
        value: overrideVal,
        unit,
        period,
        basis: validatedMetrics.basis,
        sourceId: mappedSources[0]?.id ?? 'src_1',
        metricType: 'reported' as const,
      };
    }
    return existing ?? { value: null, unit, period, basis: validatedMetrics.basis };
  };

  const recentDevelopments: DevelopmentItem[] = Array.isArray(aiSynthesis.recentDevelopments)
    ? aiSynthesis.recentDevelopments.map((value: unknown) => {
        const d = asRecord(value);
        return {
          headline: asString(d.headline, 'Corporate Update'),
          description: asString(d.whatHappened, asString(d.description)),
          whatHappened: asString(d.whatHappened, asString(d.description)),
          whyItMatters: asString(d.whyItMatters),
          date: asNullableString(d.date),
          sourceId: asNullableString(d.sourceId) ?? mappedSources[0]?.id ?? null,
          category: asString(d.category, 'General'),
        };
      })
    : [];

  const risks: RiskItem[] = Array.isArray(aiSynthesis.risks)
    ? aiSynthesis.risks.map((value: unknown) => {
        const r = asRecord(value);
        const severity = typeof r.severity === 'string' && ['high', 'medium', 'low'].includes(r.severity) ? r.severity as 'high' | 'medium' | 'low' : 'medium';
        return {
          category: asString(r.category, 'Business Risk'),
          risk: asString(r.risk, asString(r.category, 'Operational Risk')),
          description: asString(r.description),
          whyItMatters: asString(r.whyItMatters),
          evidence: asString(r.evidence),
          severity,
          sourceId: asNullableString(r.sourceId),
        };
      })
    : [];

  const managementCommentary: CommentaryItem[] = Array.isArray(aiSynthesis.managementCommentary)
    ? aiSynthesis.managementCommentary.map((value: unknown) => {
        const c = asRecord(value);
        return {
          speaker: asString(c.speaker, 'Management'),
          quote: asString(c.quote),
          context: asString(c.context, 'Investor Disclosure'),
          date: asNullableString(c.date),
          sourceId: asNullableString(c.sourceId),
        };
      })
    : [];

  const tov = aiSynthesis.technicalOverrides || {};
  const mergedTechnical = {
    price: validatedMetrics.technical?.price ?? tov.price ?? null,
    high52W: validatedMetrics.technical?.high52W ?? tov.high52W ?? null,
    low52W: validatedMetrics.technical?.low52W ?? tov.low52W ?? null,
    sma50: validatedMetrics.technical?.sma50 ?? tov.sma50 ?? null,
    sma200: validatedMetrics.technical?.sma200 ?? tov.sma200 ?? null,
    rsi: validatedMetrics.technical?.rsi ?? tov.rsi ?? null,
    trend: tov.trend || validatedMetrics.technical?.trend || 'Neutral',
    momentumSignal: tov.momentumSignal || undefined,
    supportLevels: Array.isArray(tov.supportLevels) ? tov.supportLevels : undefined,
    resistanceLevels: Array.isArray(tov.resistanceLevels) ? tov.resistanceLevels : undefined,
    observations: tov.observations || validatedMetrics.technical?.observations || undefined,
  };

  const av = aiSynthesis.analystVerdict;
  const analystVerdict: AnalystVerdict | undefined = av
    ? {
        stance: av.stance || 'Neutral / Hold',
        convictionScore: typeof av.convictionScore === 'number' ? av.convictionScore : 75,
        valuationStatus: av.valuationStatus || 'Fairly Valued',
        fairValueRange: av.fairValueRange || null,
        thesisSummary: av.thesisSummary || aiSynthesis.executiveSummary || '',
        bullCase: Array.isArray(av.bullCase) ? av.bullCase : [],
        bearCase: Array.isArray(av.bearCase) ? av.bearCase : [],
        fundamentalScorecard: Array.isArray(av.fundamentalScorecard) ? av.fundamentalScorecard : [],
      }
    : undefined;

  const defaultChatReply = `### Institutional Analyst Briefing: **${company.name}** (${company.exchange}: \`${company.ticker}\`)

${aiSynthesis.executiveSummary || `${company.name} operates in the ${company.sector ?? 'Indian equity'} sector.`}

${
  analystVerdict
    ? `#### Analyst Verdict & Thesis
- **Institutional Stance:** **${analystVerdict.stance}** ${analystVerdict.convictionScore ? `(Conviction Score: **${analystVerdict.convictionScore}/100**)` : ''}
- **Valuation Posture:** ${analystVerdict.valuationStatus || 'Reviewed against sector peers'} ${analystVerdict.fairValueRange ? `· **Reference Range:** ${analystVerdict.fairValueRange}` : ''}
- **Core Thesis:** ${analystVerdict.thesisSummary}`
    : ''
}

You can explore the **8-Tab Institutional Dossier** alongside this chat or ask me any follow-up questions about **${company.name}**'s fundamentals, balance sheet, technical support/resistance levels, peer comparisons, or latest news.`;

  const report: ResearchReport = {
    company: {
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      isin: company.isin,
      sector: company.sector ?? 'General',
      industry: company.industry ?? 'Equity',
      description: aiSynthesis.description || `${company.name} is a leading Indian listed company.`,
      marketCap: toMetric(validatedMetrics.marketCap, ov.marketCapCr, 'Cr', 'Live'),
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
      cashFlow: validatedMetrics.operatingCashFlow ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis, verificationStatus: 'unavailable', note: 'Data currently unavailable — no sufficiently reliable source found.' },
      revenueGrowth: validatedMetrics.revenueGrowth,
      profitGrowth: validatedMetrics.profitGrowth,
      netDebt: validatedMetrics.netDebt,
      debtToEquity: validatedMetrics.debtToEquity,
      freeCashFlow: validatedMetrics.freeCashFlow,
      capex: validatedMetrics.capex,
      currentRatio: validatedMetrics.currentRatio,
      interestCoverage: validatedMetrics.interestCoverage,
      totalAssets: validatedMetrics.totalAssets,
      totalLiabilities: validatedMetrics.totalLiabilities,
      currentAssets: validatedMetrics.currentAssets,
      currentLiabilities: validatedMetrics.currentLiabilities,
      shareholdersEquity: validatedMetrics.shareholdersEquity,
      equityCapital: validatedMetrics.equityCapital,
      reserves: validatedMetrics.reserves,
      operatingCashFlow: validatedMetrics.operatingCashFlow,
      investingCashFlow: validatedMetrics.investingCashFlow,
      financingCashFlow: validatedMetrics.financingCashFlow,
      interestExpense: validatedMetrics.interestExpense,
      ebit: validatedMetrics.ebit,
      workingCapital: validatedMetrics.workingCapital,
      annualTrend: validatedMetrics.annualTrend,
      quarterlyTrend: validatedMetrics.quarterlyTrend,
    },
    profitability: {
      roe: toMetric(validatedMetrics.roe, ov.roe, '%', 'FY25/TTM'),
      roce: toMetric(validatedMetrics.roce, ov.roce, '%', 'FY25/TTM'),
      netMargin: toMetric(validatedMetrics.netMargin, ov.netMarginPct, '%'),
      ebitdaMargin: toMetric(validatedMetrics.ebitdaMargin, ov.ebitdaMarginPct, '%'),
    },
    valuation: {
      pe: validatedMetrics.pe ?? { value: null, unit: 'x', period: null, basis: validatedMetrics.basis },
      pb: validatedMetrics.pb ?? { value: null, unit: 'x', period: null, basis: validatedMetrics.basis },
      marketCap: validatedMetrics.marketCap ?? { value: null, unit: '₹ Cr', period: null, basis: validatedMetrics.basis },
      dividendYield: validatedMetrics.dividendYield,
      evEbitda: validatedMetrics.evEbitda,
    },
    shareholding: {
      promoter: validatedMetrics.promoterHolding ?? { value: null, unit: '%', period: null },
      fii: validatedMetrics.fiiHolding ?? { value: null, unit: '%', period: null },
      dii: validatedMetrics.diiHolding ?? { value: null, unit: '%', period: null },
      public: validatedMetrics.publicHolding ?? { value: null, unit: '%', period: null },
      pledged: validatedMetrics.pledgedHolding ?? { value: 0, unit: '%', period: null },
      asOfDate: validatedMetrics.shareholdingAsOf ?? null,
      history: validatedMetrics.shareholdingHistory,
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
    technicalAnalysis: mergedTechnical,
    analystVerdict,
    initialChatbotReply:
      typeof aiSynthesis.initialChatbotReply === 'string' && aiSynthesis.initialChatbotReply.trim().length > 20
        ? aiSynthesis.initialChatbotReply
        : defaultChatReply,
    dataQuality: {
      ...dataQuality,
      primarySourcesCount: Math.max(dataQuality.primarySourcesCount, mappedSources.filter((s) => s.authority === 'high').length),
      secondarySourcesCount: Math.max(dataQuality.secondarySourcesCount, mappedSources.filter((s) => s.authority !== 'high').length),
      overallConfidence: mappedSources.length >= 4 ? 'High' : dataQuality.overallConfidence,
    },
    researchSummary: aiSynthesis.executiveSummary || `${company.name} fundamental research synthesis.`,
    sources: mappedSources,
    generatedAt,
    queryAsked: query,
    basisPreference: validatedMetrics.basis === 'Unspecified' ? undefined : validatedMetrics.basis,
  };

  return report;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
