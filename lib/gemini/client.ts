import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import type { CompanyIdentity, CompanyCandidate } from '@/types/company';
import type { ResearchSourceMeta } from '@/types/research';
import { extractDomain } from '@/lib/formatting/numbers';

const GEMINI_MODEL = 'gemini-3.8-flash';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

function classifyAuthority(domain: string): 'high' | 'medium' | 'low' {
  const d = domain.toLowerCase();
  if (
    ['bseindia.com', 'nseindia.com', 'sebi.gov.in', 'rbi.org.in', 'mca.gov.in'].some((h) =>
      d.includes(h)
    )
  ) {
    return 'high';
  }
  if (
    [
      'screener.in',
      'trendlyne.com',
      'tickertape.in',
      'moneycontrol.com',
      'economictimes',
      'livemint.com',
      'business-standard.com',
      'businessstandard.com',
      'financialexpress.com',
      'reuters.com',
      'bloomberg.com',
      'cnbctv18.com',
      'ndtvprofit.com',
      'thehindubusinessline.com',
      'yahoo.com',
    ].some((m) => d.includes(m))
  ) {
    return 'medium';
  }
  return 'low';
}

function classifySourceType(
  url: string,
  title: string
): ResearchSourceMeta['sourceType'] {
  const lower = `${url} ${title}`.toLowerCase();
  if (
    lower.includes('screener.in') ||
    lower.includes('trendlyne') ||
    lower.includes('tickertape') ||
    lower.includes('yahoo')
  ) {
    return 'financial_database';
  }
  if (lower.includes('annual') && lower.includes('report')) return 'annual_report';
  if (lower.includes('presentation') || lower.includes('concall') || lower.includes('transcript')) {
    return 'investor_presentation';
  }
  if (lower.includes('bseindia') || lower.includes('nseindia') || lower.includes('filing')) {
    return 'exchange_filing';
  }
  if (
    lower.includes('news') ||
    lower.includes('livemint') ||
    lower.includes('economictimes') ||
    lower.includes('reuters') ||
    lower.includes('cnbc')
  ) {
    return 'news';
  }
  return 'analysis';
}

export function extractGroundingSources(
  response: GenerateContentResponse,
  existingCount = 0
): ResearchSourceMeta[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!chunks || !Array.isArray(chunks)) return [];

  const sources: ResearchSourceMeta[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (web?.uri && !seen.has(web.uri)) {
      seen.add(web.uri);
      const domain = extractDomain(web.uri);
      const title = web.title || domain || 'Financial Web Source';
      sources.push({
        id: `src_${existingCount + sources.length + 1}`,
        url: web.uri,
        title,
        domain,
        sourceType: classifySourceType(web.uri, title),
        authority: classifyAuthority(domain),
        retrievedAt: new Date().toISOString(),
      });
    }
  }

  return sources;
}

function parseJsonFromText(rawText: string): Record<string, any> {
  const trimmed = rawText.trim();
  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  }
  return JSON.parse(candidate);
}

/**
 * Resolves any user query (company name, ticker, stock question, or finance topic)
 * using Gemini + Google Search grounding.
 */
export async function resolveCompanyWithGemini(query: string): Promise<
  | { resolved: true; company: CompanyIdentity }
  | { resolved: false; candidates: CompanyCandidate[] }
> {
  const ai = getGeminiClient();

  const systemInstruction = `You are an expert Indian & Global Equity Market Entity Resolver for Jaro AI.
Given any user query (which may be a company name, an NSE/BSE ticker, a specific question about a stock's fundamentals/technicals/news, or a general sector/market question):
1. If the query refers to a specific company (or asks a question about a specific company, e.g., "Explain Zomato fundamentals and latest news" or "Is Polycab a good buy technically?"), resolve that exact company with its primary NSE/BSE ticker.
2. If the query is an ambiguous group name with multiple major listed entities (e.g., just "Tata" or "Adani"), return resolved: false and list 3-5 top listed candidates.
3. If the query is a broader sector, index, or financial topic question (e.g., "Best defence stocks in India", "Indian IT sector outlook", "How does repo rate impact banks?"), resolve it to the most representative flagship listed leader in that space (e.g., HAL for Defence, TCS for IT, HDFCBANK for Banking, RELIANCE for Nifty/Market) so that a complete institutional benchmark report + full answer to their question can be generated.

Return ONLY valid JSON with no extra text:
{
  "resolved": true,
  "company": {
    "name": "Full Official Company Name",
    "ticker": "NSE_TICKER",
    "exchange": "NSE",
    "country": "India",
    "sector": "Sector Name",
    "industry": "Industry Name"
  },
  "candidates": []
}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Resolve the stock or financial entity for user query: "${query}"`,
    config: {
      systemInstruction,
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text ?? '{}';
  const parsed = parseJsonFromText(text);

  if (parsed.resolved && parsed.company?.name && parsed.company?.ticker) {
    return {
      resolved: true,
      company: {
        name: String(parsed.company.name),
        ticker: String(parsed.company.ticker).replace(/\.(NS|BO)$/i, '').toUpperCase(),
        exchange: parsed.company.exchange === 'BSE' ? 'BSE' : 'NSE',
        country: parsed.company.country || 'India',
        sector: parsed.company.sector || 'Equity',
        industry: parsed.company.industry || 'Listed Enterprise',
        screenerSlug: String(parsed.company.ticker).replace(/\.(NS|BO)$/i, '').toUpperCase(),
      },
    };
  }

  return {
    resolved: false,
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
  };
}

/**
 * Performs comprehensive live web search via Gemini Google Search Grounding
 * to collect financial metrics, quarterly results, technicals, analyst recommendations,
 * and latest news when Tavily is unavailable or to enrich web research.
 */
export async function collectWebResearchWithGemini(
  company: CompanyIdentity,
  userQuery: string
): Promise<{
  sources: ResearchSourceMeta[];
  screenerContent: string;
  filingContent: string;
  segmentContent: string;
  newsContent: string;
  commentaryContent: string;
  riskContent: string;
  technicalContent: string;
}> {
  const ai = getGeminiClient();

  const prompt = `Perform a comprehensive, deep institutional equity research web search for:
Company: ${company.name} (${company.exchange}: ${company.ticker})
User's specific research query: "${userQuery}"

Search the web for the latest verified data from Screener.in, NSE/BSE filings, Moneycontrol, Trendlyne, Economic Times, Mint, and earnings calls, and compile a detailed factual dossier covering:
1. FUNDAMENTAL RATIOS & VALUATION: Current Stock Price (₹), Market Cap (₹ Cr), Stock P/E, Book Value & P/B ratio, EV/EBITDA, Dividend Yield %, ROE %, ROCE %, Debt to Equity ratio, Total Debt (₹ Cr), Cash & Equivalents (₹ Cr).
2. LATEST QUARTERLY & ANNUAL FINANCIALS: Latest quarter Revenue/Sales (₹ Cr), YoY Revenue Growth %, Operating Profit / EBITDA (₹ Cr), EBITDA Margin %, Net Profit / PAT (₹ Cr), YoY PAT Growth %, Net Margin %, EPS (₹).
3. SHAREHOLDING PATTERN: Promoter holding %, FII holding %, DII holding %, Public holding %, Pledged shares %.
4. BUSINESS MODEL & SEGMENTS: Core revenue model, product portfolio, operating segment revenue shares, and domestic vs international presence.
5. TECHNICAL ANALYSIS & PRICE ACTION: 52-Week High (₹), 52-Week Low (₹), 50-Day SMA/DMA, 200-Day SMA/DMA, RSI(14), key support levels, key resistance levels, and technical trend (Bullish/Neutral/Bearish).
6. LATEST NEWS, ORDERS, QUARTERLY CONCALL & ANALYST RECOMMENDATIONS: Recent corporate developments, order book updates, capex announcements, management commentary/guidance from latest earnings call, broker/institutional target prices & consensus recommendation, and key risks.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'You are a senior equity research data collector. Search the web thoroughly and report exact numbers, periods, percentages, technical levels, and dated news facts with high precision.',
      tools: [{ googleSearch: {} }],
    },
  });

  const content = response.text ?? '';
  const groundingSources = extractGroundingSources(response, 0);

  // Ensure we always have authoritative reference links if grounding returned few chunks
  const fallbackSources: ResearchSourceMeta[] = [
    {
      id: `src_${groundingSources.length + 1}`,
      url: `https://www.screener.in/company/${encodeURIComponent(company.ticker)}/consolidated/`,
      title: `${company.name} (${company.ticker}) Consolidated Financial Statements — Screener.in`,
      domain: 'screener.in',
      sourceType: 'financial_database',
      authority: 'medium',
      retrievedAt: new Date().toISOString(),
      snippet: content.slice(0, 280),
    },
    {
      id: `src_${groundingSources.length + 2}`,
      url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(company.ticker)}`,
      title: `${company.name} (${company.ticker}) Exchange Filings & Disclosures — NSE India`,
      domain: 'nseindia.com',
      sourceType: 'exchange_filing',
      authority: 'high',
      retrievedAt: new Date().toISOString(),
      snippet: 'Official NSE corporate filings, shareholding pattern, and board announcements.',
    },
  ];

  const allSources = [...groundingSources, ...fallbackSources].slice(0, 16).map((s, idx) => ({
    ...s,
    id: `src_${idx + 1}`,
  }));

  return {
    sources: allSources,
    screenerContent: content,
    filingContent: content,
    segmentContent: content,
    newsContent: content,
    commentaryContent: content,
    riskContent: content,
    technicalContent: content,
  };
}

/**
 * Generates the complete institutional synthesis + Analyst Recommendation Verdict +
 * Initial ChatGPT-style conversational response using Gemini (with Google Search grounding).
 */
export async function analyzeWithGemini(params: {
  systemPrompt: string;
  userPrompt: string;
  useSearchGrounding?: boolean;
}): Promise<{ data: Record<string, any>; groundingSources: ResearchSourceMeta[] }> {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemPrompt,
      ...(params.useSearchGrounding !== false ? { tools: [{ googleSearch: {} }] } : {}),
    },
  });

  const text = response.text ?? '{}';
  const groundingSources = extractGroundingSources(response, 0);
  const data = parseJsonFromText(text);

  return { data, groundingSources };
}

/**
 * Streams an institutional analyst chat response using Gemini + Live Google Search Grounding.
 * Whatever the user asks related to the company, stock market, fundamentals, technicals, or finance,
 * Gemini searches the web in real time + uses the report context to answer accurately and cite sources.
 */
export async function streamChatWithGemini(params: {
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  onDelta: (text: string) => void;
  onSources?: (sources: Array<{ title: string; url: string; domain: string }>) => void;
}): Promise<void> {
  const ai = getGeminiClient();

  const contents = params.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const responseStream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: params.systemInstruction,
      tools: [{ googleSearch: {} }],
    },
  });

  const collectedSources = new Map<string, { title: string; url: string; domain: string }>();

  for await (const chunk of responseStream) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      params.onDelta(c.text);
    }
    const groundingChunks = c.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (groundingChunks && Array.isArray(groundingChunks)) {
      for (const gc of groundingChunks) {
        const web = (gc as { web?: { uri?: string; title?: string } }).web;
        if (web?.uri && !collectedSources.has(web.uri)) {
          const domain = extractDomain(web.uri);
          collectedSources.set(web.uri, {
            url: web.uri,
            title: web.title || domain || 'Web Source',
            domain,
          });
        }
      }
    }
  }

  if (params.onSources && collectedSources.size > 0) {
    params.onSources(Array.from(collectedSources.values()));
  }
}
