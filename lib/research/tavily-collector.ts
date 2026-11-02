import {
  tavilySearchWithFallback,
  tavilyExtractWithFallback,
} from '@/lib/tavily/client';
import {
  isGeminiConfigured,
  collectWebResearchWithGemini,
} from '@/lib/gemini/client';
import type { CompanyIdentity } from '@/types/company';
import type { ResearchSourceMeta } from '@/types/research';
import { extractDomain } from '@/lib/formatting/numbers';

export interface CollectedWebData {
  sources: ResearchSourceMeta[];
  screenerContent?: string;
  filingContent?: string;
  segmentContent?: string;
  newsContent?: string;
  commentaryContent?: string;
  riskContent?: string;
  technicalContent?: string;
  allRawSnippets: Array<{
    url: string;
    title: string;
    content: string;
    domain: string;
    sourceType: ResearchSourceMeta['sourceType'];
    authority: 'high' | 'medium' | 'low';
    publishedDate?: string;
  }>;
}

const TIER_1_DOMAINS = [
  'bseindia.com', 'nseindia.com', 'sebi.gov.in', 'rbi.org.in',
  'ril.com', 'tcs.com', 'hdfcbank.com', 'infosys.com', 'tatamotors.com',
  'itcportal.com', 'larsentoubro.com', 'hal-india.co.in', 'bel-india.in',
  'investor.tatamotors.com',
];

const TIER_2_DOMAINS = [
  'screener.in', 'trendlyne.com', 'tickertape.in', 'moneycontrol.com',
  'livemint.com', 'economictimes.indiatimes.com', 'businessstandard.com',
  'financialexpress.com', 'reuters.com', 'bloomberg.com', 'cnbctv18.com',
  'thehindubusinessline.com',
];

export function getDomainAuthority(domain: string): 'high' | 'medium' | 'low' {
  const d = domain.toLowerCase();
  if (TIER_1_DOMAINS.some((td) => d.includes(td))) return 'high';
  if (TIER_2_DOMAINS.some((td) => d.includes(td))) return 'medium';
  return 'low';
}

export function classifySourceType(url: string, title: string): ResearchSourceMeta['sourceType'] {
  const lower = `${url} ${title}`.toLowerCase();
  if (lower.includes('screener.in') || lower.includes('trendlyne.com') || lower.includes('tickertape.in') || lower.includes('moneycontrol.com/financials')) {
    return 'financial_database';
  }
  if (lower.includes('annual-report') || lower.includes('annual report') || lower.includes('integrated-report')) {
    return 'annual_report';
  }
  if (lower.includes('investor-presentation') || lower.includes('investor presentation') || lower.includes('earnings-presentation')) {
    return 'investor_presentation';
  }
  if (lower.includes('bseindia.com') || lower.includes('nseindia.com') || lower.includes('corporate-announcement') || lower.includes('filing') || lower.includes('results')) {
    return 'exchange_filing';
  }
  if (lower.includes('reuters') || lower.includes('livemint') || lower.includes('economictimes') || lower.includes('businessstandard') || lower.includes('news')) {
    return 'news';
  }
  return 'analysis';
}

function hasTavilyKey(): boolean {
  for (const [k, v] of Object.entries(process.env)) {
    if (/^TAVILY_API_KEY(_\d+)?$/i.test(k) && v && v.trim() && !v.trim().startsWith('your_')) {
      return true;
    }
  }
  return false;
}

/**
 * Builds and executes the targeted multi-source research plan.
 * Uses Tavily when configured, and seamlessly falls back to or enriches with
 * Gemini Google Search Grounding so web search always succeeds.
 */
export async function collectMultiSourceData(
  company: CompanyIdentity,
  onStep?: (msg: string) => void,
  userQuery = ''
): Promise<CollectedWebData> {
  const { name, ticker } = company;

  // If Tavily is not configured, use Gemini Google Search Grounding directly
  if (!hasTavilyKey() && isGeminiConfigured()) {
    onStep?.('Searching live financial web via Google Search grounding (Screener, NSE/BSE, Moneycontrol, News)');
    const geminiData = await collectWebResearchWithGemini(company, userQuery || name);
    return {
      ...geminiData,
      allRawSnippets: geminiData.sources.map((s) => ({
        url: s.url,
        title: s.title,
        content: s.snippet || '',
        domain: s.domain,
        sourceType: s.sourceType,
        authority: s.authority,
      })),
    };
  }

  const searchQueries = [
    {
      key: 'screener',
      query: `${name} ${ticker} site:screener.in`,
      includeDomains: ['screener.in'],
      maxResults: 3,
    },
    {
      key: 'filings',
      query: `${name} ${ticker} corporate announcement quarterly financial results BSE NSE`,
      includeDomains: ['bseindia.com', 'nseindia.com'],
      maxResults: 3,
    },
    {
      key: 'presentation',
      query: `${name} investor presentation Q1 Q2 Q3 Q4 FY2025 FY2026 earnings conference call`,
      timeRange: 'year' as const,
      maxResults: 4,
    },
    {
      key: 'segments',
      query: `${name} revenue breakdown by segment product share domestic export annual report`,
      maxResults: 3,
    },
    {
      key: 'shareholding',
      query: `${name} ${ticker} shareholding pattern promoter FII DII pledged shares 2025`,
      includeDomains: ['screener.in', 'trendlyne.com', 'bseindia.com'],
      timeRange: 'year' as const,
      maxResults: 3,
    },
    {
      key: 'developments',
      query: `${name} ${ticker} orders contracts acquisition capex expansion 2025 2026 livemint OR economictimes OR "business standard"`,
      timeRange: 'year' as const,
      maxResults: 4,
    },
    {
      key: 'risks',
      query: `${name} ${ticker} key risks challenges regulatory headwind raw material competition`,
      maxResults: 3,
    },
    {
      key: 'technical',
      query: `${name} ${ticker} 52 week high low RSI moving average 50 200 DMA moneycontrol OR trendlyne`,
      maxResults: 3,
    },
  ];

  onStep?.('Executing targeted research queries across BSE, NSE, Screener, and financial press');

  const allResults: Array<{
    key: string;
    url: string;
    title: string;
    content: string;
  }> = [];

  const seenUrls = new Set<string>();

  try {
    for (let i = 0; i < searchQueries.length; i += 4) {
      const batch = searchQueries.slice(i, i + 4);
      const settled = await Promise.allSettled(
        batch.map(async (item) => {
          const resp = await tavilySearchWithFallback(item.query, {
            searchDepth: 'advanced',
            maxResults: item.maxResults,
            includeAnswer: false,
            includeRawContent: false,
            ...(item.includeDomains ? { includeDomains: item.includeDomains } : {}),
            ...(item.timeRange ? { days: 365 } : {}),
          });
          return { key: item.key, results: resp.results ?? [] };
        })
      );

      for (const res of settled) {
        if (res.status === 'fulfilled') {
          for (const r of res.value.results) {
            if (!seenUrls.has(r.url)) {
              seenUrls.add(r.url);
              allResults.push({
                key: res.value.key,
                url: r.url,
                title: r.title ?? '',
                content: r.content ?? '',
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[tavily-collector] Tavily search failed, falling back to Gemini Google Search:', err);
  }

  // If Tavily returned no results (e.g. quota exhausted), fall back to Gemini Google Search
  if (allResults.length === 0 && isGeminiConfigured()) {
    onStep?.('Falling back to Google Search grounding for live financial & news collection');
    const geminiData = await collectWebResearchWithGemini(company, userQuery || name);
    return {
      ...geminiData,
      allRawSnippets: geminiData.sources.map((s) => ({
        url: s.url,
        title: s.title,
        content: s.snippet || '',
        domain: s.domain,
        sourceType: s.sourceType,
        authority: s.authority,
      })),
    };
  }

  const screenerUrl = allResults.find((r) => r.url.includes('screener.in/company/'))?.url;
  const filingUrl = allResults.find((r) => r.url.includes('bseindia.com') || r.url.includes('nseindia.com'))?.url;
  const presentationUrl = allResults.find((r) => r.key === 'presentation' && (r.url.includes('pdf') || r.url.includes('investor')))?.url;
  const newsUrl = allResults.find((r) => r.key === 'developments' && (r.url.includes('livemint') || r.url.includes('economictimes') || r.url.includes('businessstandard')))?.url;

  const extractCandidates = [screenerUrl, filingUrl, presentationUrl, newsUrl].filter(Boolean) as string[];

  const extractedMap = new Map<string, string>();
  if (extractCandidates.length > 0) {
    onStep?.(`Deep-extracting financial tables and disclosures from ${extractCandidates.length} authoritative sources`);
    try {
      const extractResp = await tavilyExtractWithFallback(extractCandidates);
      if (extractResp.results) {
        for (const er of extractResp.results) {
          if (er.url && er.rawContent) {
            const maxLen = er.url.includes('screener.in') ? 30000 : 6000;
            extractedMap.set(er.url, er.rawContent.slice(0, maxLen));
          }
        }
      }
    } catch (err) {
      console.warn('[tavily-collector] extract failed (non-fatal):', err);
    }
  }

  for (const r of allResults) {
    const ext = extractedMap.get(r.url);
    if (ext && ext.length > r.content.length) {
      r.content = ext;
    }
  }

  let screenerContent = '';
  let filingContent = '';
  let segmentContent = '';
  let newsContent = '';
  let commentaryContent = '';
  let riskContent = '';
  let technicalContent = '';

  for (const r of allResults) {
    if (r.url.includes('screener.in') || r.key === 'screener') {
      screenerContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    } else if (r.key === 'filings' || r.url.includes('bseindia') || r.url.includes('nseindia')) {
      filingContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    } else if (r.key === 'segments') {
      segmentContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    } else if (r.key === 'developments') {
      newsContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    } else if (r.key === 'presentation') {
      commentaryContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    } else if (r.key === 'risks') {
      riskContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    } else if (r.key === 'technical') {
      technicalContent += `\n[URL: ${r.url}]\n${r.title}\n${r.content}\n`;
    }
  }

  const allRawSnippets = allResults.map((r) => {
    const domain = extractDomain(r.url);
    const authority = getDomainAuthority(domain);
    const sourceType = classifySourceType(r.url, r.title);
    return {
      url: r.url,
      title: r.title,
      content: r.content,
      domain,
      sourceType,
      authority,
    };
  });

  const rankedSnippets = [...allRawSnippets].sort((a, b) => {
    const score = { high: 3, medium: 2, low: 1 };
    return score[b.authority] - score[a.authority];
  });

  const sources: ResearchSourceMeta[] = rankedSnippets.slice(0, 16).map((s, idx) => ({
    id: `src_${idx + 1}`,
    url: s.url,
    title: s.title,
    domain: s.domain,
    sourceType: s.sourceType,
    authority: s.authority,
    retrievedAt: new Date().toISOString(),
    snippet: s.content.slice(0, 300),
  }));

  return {
    sources,
    screenerContent,
    filingContent,
    segmentContent,
    newsContent,
    commentaryContent,
    riskContent,
    technicalContent,
    allRawSnippets,
  };
}
