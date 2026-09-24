/**
 * Tavily client — upgraded with Tavily best practices:
 *  • searchDepth "advanced" for high-relevance results
 *  • time_range for fresh financial data
 *  • include_domains for authoritative Indian financial sources
 *  • extract() for deep full-page content on top URLs
 *  • Dedup + authority-ranked source filtering
 */

import { tavily } from '@tavily/core';
import type { CompanyIdentity } from '@/types/company';
import type { ResearchSourceMeta } from '@/types/research';
import { extractDomain } from '@/lib/formatting/numbers';

// ── Multi-Key Tavily Client Pool with Automatic Failover ─────────────────────

export interface TavilyKeyItem {
  key: string;
  masked: string;
  client: ReturnType<typeof tavily>;
}

let keyPool: TavilyKeyItem[] = [];
let currentKeyIdx = 0;

function buildTavilyPool(): TavilyKeyItem[] {
  // Dynamically collect all TAVILY_API_KEY, TAVILY_API_KEY_2 ... TAVILY_API_KEY_N env vars
  const rawCandidateKeys: string[] = [];

  // 1. Check numbered sequence 1..20
  const numberedKeys = [
    process.env.TAVILY_API_KEY,
    process.env.TAVILY_API_KEY_2,
    process.env.TAVILY_API_KEY_3,
    process.env.TAVILY_API_KEY_4,
    process.env.TAVILY_API_KEY_5,
    process.env.TAVILY_API_KEY_6,
    process.env.TAVILY_API_KEY_7,
    process.env.TAVILY_API_KEY_8,
    process.env.TAVILY_API_KEY_9,
    process.env.TAVILY_API_KEY_10,
  ];
  for (const k of numberedKeys) {
    if (k) rawCandidateKeys.push(k);
  }

  // 2. Scan all process.env keys matching TAVILY_API_KEY pattern
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (/^TAVILY_API_KEY(_\d+)?$/i.test(envKey) && envVal) {
      // Support comma or newline-separated keys within a single env var
      const parts = envVal.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      rawCandidateKeys.push(...parts);
    }
  }

  const pool: TavilyKeyItem[] = [];
  const seenKeys = new Set<string>();

  for (const raw of rawCandidateKeys) {
    const k = raw.trim();
    if (k && !k.startsWith('your_') && !seenKeys.has(k)) {
      seenKeys.add(k);
      const masked = `${k.slice(0, 10)}...${k.slice(-4)}`;
      pool.push({
        key: k,
        masked,
        client: tavily({ apiKey: k }),
      });
    }
  }

  if (pool.length === 0) {
    throw new Error('No valid TAVILY_API_KEY configured. Please check .env.local');
  }

  console.log(`[tavily] Initialized client pool with ${pool.length} key(s) for automatic fallback:`);
  pool.forEach((item, idx) => {
    console.log(`   [tavily key ${idx + 1}] ${item.masked}`);
  });
  return pool;
}

export function getTavilyPool(): TavilyKeyItem[] {
  if (keyPool.length === 0) {
    keyPool = buildTavilyPool();
  }
  return keyPool;
}

export async function withTavilyFallback<T>(
  fn: (client: ReturnType<typeof tavily>, keyIndex: number, maskedKey: string) => Promise<T>
): Promise<T> {
  const pool = getTavilyPool();
  const maxAttempts = pool.length;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const activeIdx = (currentKeyIdx + attempt) % pool.length;
    const current = pool[activeIdx];

    try {
      const result = await fn(current.client, activeIdx, current.masked);
      currentKeyIdx = activeIdx; // Remember successful key
      return result;
    } catch (err: unknown) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[tavily] Key ${activeIdx + 1}/${pool.length} (${current.masked}) failed: ${errMsg}. Rotating to next key...`
      );
      currentKeyIdx = (activeIdx + 1) % pool.length;
    }
  }

  throw new Error(
    `[tavily] All ${pool.length} Tavily API keys exhausted or failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export async function tavilySearchWithFallback(
  query: string,
  options: Parameters<ReturnType<typeof tavily>['search']>[1]
) {
  return withTavilyFallback((client) => client.search(query, options));
}

export async function tavilyExtractWithFallback(urls: string[]) {
  return withTavilyFallback((client) => client.extract(urls));
}

function getTavilyClient() {
  const pool = getTavilyPool();
  return pool[currentKeyIdx % pool.length].client;
}

// ── Source Authority ─────────────────────────────────────────────────────────

const HIGH_AUTHORITY_DOMAINS = [
  'nseindia.com', 'nse.co.in', 'bseindia.com',
  'sebi.gov.in', 'mca.gov.in', 'rbi.org.in',
];

const MEDIUM_AUTHORITY_DOMAINS = [
  'reuters.com', 'bloomberg.com',
  'economictimes.indiatimes.com', 'businessstandard.com',
  'livemint.com', 'financialexpress.com', 'moneycontrol.com',
  'cnbctv18.com', 'ndtvprofit.com', 'thehindubusinessline.com',
  'zeebiz.com', 'screener.in', 'tickertape.in', 'trendlyne.com',
  'valuepickr.com', 'capitalmind.in',
];

// Domains to include across all searches for better quality (Tavily best practice)
const PREFERRED_DOMAINS = [
  'screener.in', 'tickertape.in', 'trendlyne.com',
  'bseindia.com', 'nseindia.com', 'moneycontrol.com',
  'economictimes.indiatimes.com', 'livemint.com',
  'businessstandard.com', 'financialexpress.com',
];

function getAuthority(domain: string): 'high' | 'medium' | 'low' {
  const d = domain.toLowerCase();
  if (HIGH_AUTHORITY_DOMAINS.some((h) => d.includes(h))) return 'high';
  if (MEDIUM_AUTHORITY_DOMAINS.some((m) => d.includes(m))) return 'medium';
  return 'low';
}

function getSourceType(
  url: string,
  title: string
): ResearchSourceMeta['sourceType'] {
  const combined = `${url} ${title}`.toLowerCase();
  if (
    combined.includes('annual-report') ||
    combined.includes('annual report')
  )
    return 'annual_report';
  if (
    combined.includes('investor-presentation') ||
    combined.includes('investor presentation')
  )
    return 'investor_presentation';
  if (
    combined.includes('bseindia.com') ||
    combined.includes('nseindia.com') ||
    combined.includes('corporate-filing') ||
    combined.includes('quarterly result') ||
    combined.includes('q1') ||
    combined.includes('q2') ||
    combined.includes('q3') ||
    combined.includes('q4')
  )
    return 'exchange_filing';
  if (
    combined.includes('news') ||
    combined.includes('reuters') ||
    combined.includes('bloomberg')
  )
    return 'news';
  if (combined.includes('analysis') || combined.includes('research'))
    return 'analysis';
  return 'other';
}

// ── Research Query Plan ──────────────────────────────────────────────────────
// Follows Tavily best practices: focused, specific queries < 400 chars each
// Include both NSE ticker and full name for better coverage

interface SearchPlan {
  query: string;
  /** Override preferred include_domains for specific queries */
  includeDomains?: string[];
  /** Tavily time_range: "day" | "week" | "month" | "year" */
  timeRange?: 'day' | 'week' | 'month' | 'year';
  maxResults?: number;
}

function buildSearchPlan(company: CompanyIdentity): SearchPlan[] {
  const { name, ticker } = company;

  return [
    // 1. Screener financial data — best for structured financials
    {
      query: `${name} ${ticker} financials revenue profit ROE ROCE EPS`,
      includeDomains: ['screener.in', 'tickertape.in', 'trendlyne.com'],
      maxResults: 5,
    },
    // 2. Latest quarterly results (fresh data only)
    {
      query: `${name} quarterly results FY2025 FY2026 revenue profit`,
      timeRange: 'year',
      maxResults: 5,
    },
    // 3. BSE/NSE exchange filings
    {
      query: `${name} ${ticker} BSE NSE filing quarterly results`,
      includeDomains: ['bseindia.com', 'nseindia.com'],
      maxResults: 5,
    },
    // 4. Business model + segments (evergreen)
    {
      query: `${name} business model products segments revenue breakdown overview`,
      maxResults: 5,
    },
    // 5. Shareholding pattern (recent)
    {
      query: `${name} ${ticker} shareholding pattern promoter FII DII 2025`,
      timeRange: 'year',
      maxResults: 4,
    },
    // 6. Orders, contracts, expansions (news)
    {
      query: `${name} orders contracts wins expansion acquisition 2025 2026`,
      timeRange: 'year',
      maxResults: 5,
    },
    // 7. Risks and industry outlook
    {
      query: `${name} ${ticker} risks challenges competition industry outlook`,
      maxResults: 4,
    },
    // 8. Management commentary / earnings call
    {
      query: `${name} management commentary earnings call guidance FY2026`,
      timeRange: 'year',
      maxResults: 4,
    },
    // 9. Valuation
    {
      query: `${name} ${ticker} PE ratio EV EBITDA market cap valuation 2025`,
      timeRange: 'year',
      maxResults: 4,
    },
    // 10. Annual report / investor presentation (deep research sources)
    {
      query: `${name} annual report investor presentation 2024 2025`,
      maxResults: 4,
    },
  ];
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TavilySearchResult {
  url: string;
  title: string;
  content: string;
  score?: number;
  publishedDate?: string;
}

export interface TavilyResearchResults {
  sources: ResearchSourceMeta[];
  rawResults: TavilySearchResult[];
}

// ── Main Research Function ───────────────────────────────────────────────────

export async function performResearch(
  company: CompanyIdentity
): Promise<TavilyResearchResults> {
  const plan = buildSearchPlan(company);

  const allRawResults: TavilySearchResult[] = [];
  const seenUrls = new Set<string>();

  // Run searches in batches of 3 (Tavily best practice: parallel async queries)
  for (let i = 0; i < plan.length; i += 3) {
    const batch = plan.slice(i, i + 3);

    const batchResults = await Promise.allSettled(
      batch.map((p) =>
        tavilySearchWithFallback(p.query, {
          searchDepth: 'advanced',        // Always use advanced for stock research
          maxResults: p.maxResults ?? 5,
          includeAnswer: false,
          includeRawContent: false,
          ...(p.includeDomains ? { includeDomains: p.includeDomains } : {}),
          ...(p.timeRange ? { days: timeRangeToDays(p.timeRange) } : {}),
        })
      )
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.results) {
        for (const r of result.value.results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allRawResults.push({
              url: r.url,
              title: r.title ?? '',
              content: r.content ?? '',
              score: r.score,
              publishedDate: r.publishedDate,
            });
          }
        }
      }
    }
  }

  // Filter and rank results
  const filtered = filterAndPrioritize(allRawResults, company.name);

  // ── Tavily extract() — deep content for top high-authority URLs ──────────
  // Best practice: use extract() on top URLs to get full page content
  // rather than just snippets, yielding richer financial context
  const topUrls = filtered
    .filter((r) => {
      const auth = getAuthority(extractDomain(r.url));
      return auth === 'high' || auth === 'medium';
    })
    .slice(0, 8) // Extract top 8 high/medium authority pages
    .map((r) => r.url);

  if (topUrls.length > 0) {
    try {
      const extractResult = await tavilyExtractWithFallback(topUrls);
      const extractedMap = new Map<string, string>();

      if (extractResult.results) {
        for (const er of extractResult.results) {
          if (er.url && er.rawContent) {
            // Truncate to 1500 chars to keep context within token limits
            extractedMap.set(er.url, er.rawContent.slice(0, 1500));
          }
        }
      }

      // Merge extracted content into filtered results
      for (const r of filtered) {
        const extracted = extractedMap.get(r.url);
        if (extracted && extracted.length > r.content.length) {
          r.content = extracted;
        }
      }

      console.log(
        `[tavily] Extracted full content from ${extractedMap.size}/${topUrls.length} URLs`
      );
    } catch (err) {
      // Extract is optional — log and continue
      console.warn('[tavily] extract() failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  // Limit to top 20 sources to keep LLM context under token limits
  const limited = filtered.slice(0, 20);

  // Convert to source metadata
  const sources: ResearchSourceMeta[] = limited.map((r, idx) => {
    const domain = extractDomain(r.url);
    const authority = getAuthority(domain);
    const sourceType = getSourceType(r.url, r.title);

    return {
      id: `src_${idx + 1}`,
      url: r.url,
      title: r.title,
      domain,
      sourceType,
      authority,
      relevance: r.score,
      publishedAt: r.publishedDate,
      retrievedAt: new Date().toISOString(),
      snippet: r.content.slice(0, 300),
    };
  });

  return { sources, rawResults: limited };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeRangeToDays(range: 'day' | 'week' | 'month' | 'year'): number {
  switch (range) {
    case 'day':   return 1;
    case 'week':  return 7;
    case 'month': return 30;
    case 'year':  return 365;
  }
}

function filterAndPrioritize(
  results: TavilySearchResult[],
  companyName: string
): TavilySearchResult[] {
  const companyKeyword = companyName.split(' ')[0].toLowerCase();

  // Filter: keep results that are clearly related to the company
  const filtered = results.filter((r) => {
    const combined = `${r.title} ${r.content}`.toLowerCase();
    return (
      combined.includes(companyKeyword) ||
      combined.includes('nse') ||
      combined.includes('bse') ||
      (r.score !== undefined && r.score > 0.5) // Trust high-scored results
    );
  });

  // Sort: high authority → by Tavily relevance score
  return filtered.sort((a, b) => {
    const authA = getAuthority(extractDomain(a.url));
    const authB = getAuthority(extractDomain(b.url));
    const authScore = { high: 3, medium: 2, low: 1 };

    const aScore = authScore[authA] * 10 + (a.score ?? 0);
    const bScore = authScore[authB] * 10 + (b.score ?? 0);

    return bScore - aScore;
  });
}

// ── Build Research Context for LLM ──────────────────────────────────────────

export function buildResearchContext(
  sources: ResearchSourceMeta[],
  rawResults: TavilySearchResult[]
): string {
  let context = '';

  // URL → source ID map
  const urlToId = new Map<string, string>();
  sources.forEach((s, i) => {
    urlToId.set(s.url, s.id ?? `src_${i + 1}`);
  });

  // Group by source type
  const byType = new Map<string, typeof rawResults>();

  for (const r of rawResults) {
    const source = sources.find((s) => s.url === r.url);
    const type = source?.sourceType ?? 'other';

    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(r);
  }

  const sectionHeaders: Record<string, string> = {
    annual_report:          'ANNUAL REPORTS',
    investor_presentation:  'INVESTOR PRESENTATIONS',
    exchange_filing:        'EXCHANGE FILINGS / RESULTS',
    news:                   'NEWS AND DEVELOPMENTS',
    analysis:               'RESEARCH AND ANALYSIS',
    other:                  'OTHER SOURCES',
  };

  // Priority order for context sections
  const typeOrder = [
    'exchange_filing',
    'annual_report',
    'investor_presentation',
    'analysis',
    'news',
    'other',
  ];

  for (const type of typeOrder) {
    const items = byType.get(type);
    if (!items || items.length === 0) continue;

    context += `\n\n=== ${sectionHeaders[type] ?? type.toUpperCase()} ===\n`;

    // Cap at 4 items per section and 600 chars per item to stay under token limits
    const capped = items.slice(0, 4);
    for (const item of capped) {
      const sourceId = urlToId.get(item.url) ?? 'unknown';
      context += `\n[SOURCE_ID: ${sourceId}]\n`;
      context += `Title: ${item.title}\n`;
      context += `URL: ${item.url}\n`;
      if (item.publishedDate) context += `Published: ${item.publishedDate}\n`;
      context += `Content:\n${item.content.slice(0, 600)}\n`;
      context += '---\n';
    }
  }

  // Source index footer
  context += '\n\n=== SOURCE INDEX ===\n';
  for (const s of sources) {
    context += `[${s.id}] ${s.title} — ${s.domain} (${s.sourceType})\n`;
  }

  return context;
}
