import { tavilySearchWithFallback } from '@/lib/tavily/client';
import { fetchLiveMarketData } from '@/lib/yahoo-finance/client';
import { extractDomain } from '@/lib/formatting/numbers';
import type { ResearchSourceMeta } from '@/types/research';
import type {
  ResearchIntent,
  ScreeningFilters,
  ScreeningResultRow,
} from '@/types/conversation';

interface ResearchEvidence {
  context: string;
  sources: ResearchSourceMeta[];
  retrievedAt: string;
}

export const INDIAN_EQUITY_UNIVERSE = [
  { ticker: 'RELIANCE', name: 'Reliance Industries' },
  { ticker: 'TCS', name: 'Tata Consultancy Services' },
  { ticker: 'HDFCBANK', name: 'HDFC Bank' },
  { ticker: 'INFY', name: 'Infosys' },
  { ticker: 'ICICIBANK', name: 'ICICI Bank' },
  { ticker: 'SBIN', name: 'State Bank of India' },
  { ticker: 'BHARTIARTL', name: 'Bharti Airtel' },
  { ticker: 'ITC', name: 'ITC' },
  { ticker: 'LT', name: 'Larsen & Toubro' },
  { ticker: 'HINDUNILVR', name: 'Hindustan Unilever' },
  { ticker: 'KOTAKBANK', name: 'Kotak Mahindra Bank' },
  { ticker: 'AXISBANK', name: 'Axis Bank' },
  { ticker: 'BAJFINANCE', name: 'Bajaj Finance' },
  { ticker: 'MARUTI', name: 'Maruti Suzuki' },
  { ticker: 'TATAMOTORS', name: 'Tata Motors' },
  { ticker: 'SUNPHARMA', name: 'Sun Pharmaceutical' },
  { ticker: 'DRREDDY', name: "Dr. Reddy's Laboratories" },
  { ticker: 'TITAN', name: 'Titan Company' },
  { ticker: 'ASIANPAINT', name: 'Asian Paints' },
  { ticker: 'ULTRACEMCO', name: 'UltraTech Cement' },
  { ticker: 'NTPC', name: 'NTPC' },
  { ticker: 'POWERGRID', name: 'Power Grid Corporation' },
  { ticker: 'ONGC', name: 'Oil and Natural Gas Corporation' },
  { ticker: 'COALINDIA', name: 'Coal India' },
  { ticker: 'HAL', name: 'Hindustan Aeronautics' },
  { ticker: 'BEL', name: 'Bharat Electronics' },
  { ticker: 'TRENT', name: 'Trent' },
  { ticker: 'DIXON', name: 'Dixon Technologies' },
  { ticker: 'KPITTECH', name: 'KPIT Technologies' },
  { ticker: 'PERSISTENT', name: 'Persistent Systems' },
] as const;

const OFFICIAL_DOMAINS = ['nseindia.com', 'bseindia.com', 'sebi.gov.in', 'rbi.org.in', 'amfiindia.com'];
const REPUTABLE_DOMAINS = [
  'reuters.com',
  'livemint.com',
  'economictimes.indiatimes.com',
  'businessstandard.com',
  'moneycontrol.com',
  'cnbctv18.com',
  'screener.in',
];

export async function collectQuestionEvidence(
  query: string,
  intent: ResearchIntent,
  sector?: string | null,
): Promise<ResearchEvidence> {
  const retrievedAt = new Date().toISOString();
  const freshness = ['market_analysis', 'news_announcements', 'results_analysis'].includes(intent)
    ? 'latest today 2026'
    : 'latest data India';
  const subject = sector ? `${sector} sector India` : query;

  const plans = buildEvidenceQueries(subject, query, intent, freshness);
  const settled = await Promise.allSettled(
    plans.map((plan) => tavilySearchWithFallback(plan.query, {
      searchDepth: 'advanced',
      maxResults: plan.maxResults,
      includeAnswer: false,
      includeRawContent: false,
      ...(plan.domains ? { includeDomains: plan.domains } : {}),
      ...(plan.days ? { days: plan.days } : {}),
    })),
  );

  const seen = new Set<string>();
  const results: Array<{ url: string; title: string; content: string; publishedDate?: string }> = [];
  for (const item of settled) {
    if (item.status !== 'fulfilled') continue;
    for (const result of item.value.results ?? []) {
      if (!result.url || seen.has(result.url)) continue;
      seen.add(result.url);
      results.push({
        url: result.url,
        title: result.title ?? result.url,
        content: result.content ?? '',
        publishedDate: result.publishedDate,
      });
    }
  }

  const ranked = results.sort((a, b) => authorityScore(b.url) - authorityScore(a.url)).slice(0, 14);
  const sources: ResearchSourceMeta[] = ranked.map((result, index) => ({
    id: `evidence_${index + 1}`,
    url: result.url,
    title: result.title,
    domain: extractDomain(result.url),
    sourceType: classifyType(result.url, result.title),
    authority: authorityScore(result.url) >= 3 ? 'high' : authorityScore(result.url) >= 2 ? 'medium' : 'low',
    publishedAt: result.publishedDate,
    retrievedAt,
    snippet: result.content.slice(0, 350),
  }));

  const context = ranked.map((result, index) => {
    const source = sources[index];
    return `[${source.id}] ${result.title}\nURL: ${result.url}\nPublished: ${result.publishedDate ?? 'Not provided'}\n${result.content.slice(0, 1400)}`;
  }).join('\n\n---\n\n');

  return { context, sources, retrievedAt };
}

export async function screenIndianEquities(filters: ScreeningFilters = {}): Promise<{
  rows: ScreeningResultRow[];
  sources: ResearchSourceMeta[];
  universeSize: number;
  appliedFilters: string[];
  retrievedAt: string;
  limitations: string[];
}> {
  const retrievedAt = new Date().toISOString();
  const all: ScreeningResultRow[] = [];

  // Batches prevent a burst of 60 quote/summary calls from overwhelming Yahoo.
  for (let i = 0; i < INDIAN_EQUITY_UNIVERSE.length; i += 6) {
    const batch = INDIAN_EQUITY_UNIVERSE.slice(i, i + 6);
    const settled = await Promise.allSettled(batch.map(async (company) => {
      const data = await fetchLiveMarketData(company.ticker, 'NSE');
      if (!data || !data.price) return null;
      const marketCapCr = data.marketCap == null ? null : data.marketCap / 1e7;
      const lowDistance = data.low52w > 0 ? ((data.price - data.low52w) / data.low52w) * 100 : null;
      return {
        name: data.longName || company.name,
        ticker: company.ticker,
        sector: data.sector,
        price: data.price,
        marketCapCr,
        revenueGrowthPct: toPct(data.revenueGrowth),
        earningsGrowthPct: toPct(data.earningsGrowth),
        roePct: toPct(data.returnOnEquity),
        debtToEquity: data.debtToEquity == null ? null : data.debtToEquity / 100,
        operatingCashFlowCr: data.operatingCashflow == null ? null : data.operatingCashflow / 1e7,
        freeCashFlowCr: data.freeCashflow == null ? null : data.freeCashflow / 1e7,
        distanceFrom52WeekLowPct: lowDistance,
        institutionalHoldingPct: toPct(data.heldPercentInstitutions),
        fetchedAt: data.fetchedAt,
      } satisfies ScreeningResultRow;
    }));
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) all.push(item.value);
    }
  }

  const limitations: string[] = [];
  if (filters.minRocePct != null) {
    limitations.push('ROCE is not consistently available from market data providers. The ROCE condition was not applied; verify ROCE against audited filings or Screener before drawing conclusions.');
  }

  const filtered = all.filter((row) => {
    if (filters.marketCapMinCr != null && (row.marketCapCr == null || row.marketCapCr < filters.marketCapMinCr)) return false;
    if (filters.marketCapMaxCr != null && (row.marketCapCr == null || row.marketCapCr > filters.marketCapMaxCr)) return false;
    if (filters.minRevenueGrowthPct != null && (row.revenueGrowthPct == null || row.revenueGrowthPct < filters.minRevenueGrowthPct)) return false;
    if (filters.minEarningsGrowthPct != null && (row.earningsGrowthPct == null || row.earningsGrowthPct < filters.minEarningsGrowthPct)) return false;
    if (filters.minRoePct != null && (row.roePct == null || row.roePct < filters.minRoePct)) return false;
    if (filters.maxDebtToEquity != null && (row.debtToEquity == null || row.debtToEquity > filters.maxDebtToEquity)) return false;
    if (filters.minOperatingCashFlowCr != null && (row.operatingCashFlowCr == null || row.operatingCashFlowCr < filters.minOperatingCashFlowCr)) return false;
    if (filters.minFreeCashFlowCr != null && (row.freeCashFlowCr == null || row.freeCashFlowCr < filters.minFreeCashFlowCr)) return false;
    if (filters.maxDistanceFrom52WeekLowPct != null && (row.distanceFrom52WeekLowPct == null || row.distanceFrom52WeekLowPct > filters.maxDistanceFrom52WeekLowPct)) return false;
    if (filters.minInstitutionalHoldingPct != null && (row.institutionalHoldingPct == null || row.institutionalHoldingPct < filters.minInstitutionalHoldingPct)) return false;
    if (filters.sector && !row.sector?.toLowerCase().includes(filters.sector.toLowerCase())) return false;
    return true;
  });

  const ranked = filtered
    .sort((a, b) => qualityScore(b) - qualityScore(a))
    .slice(0, Math.min(Math.max(filters.limit ?? 10, 1), 15))
    .map((row) => {
      const score = structuredQualityScore(row);
      return {
        ...row,
        qualityScore: score,
        qualityCategory: score >= 75 ? 'high-quality candidate' as const
          : score >= 60 ? 'growth research candidate' as const
            : score >= 45 ? 'mixed-quality candidate' as const
              : 'higher-risk candidate' as const,
      };
    });

  const sources: ResearchSourceMeta[] = ranked.map((row, index) => ({
    id: `yahoo_${index + 1}`,
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(row.ticker)}.NS`,
    title: `${row.name} market and fundamental data`,
    domain: 'finance.yahoo.com',
    sourceType: 'financial_database',
    authority: 'medium',
    retrievedAt: row.fetchedAt,
    snippet: 'Live market data and fundamental information from financial data providers.',
  }));

  return {
    rows: ranked,
    sources,
    universeSize: all.length,
    appliedFilters: describeFilters(filters),
    retrievedAt,
    limitations,
  };
}

function buildEvidenceQueries(subject: string, original: string, intent: ResearchIntent, freshness: string) {
  if (intent === 'market_analysis') {
    return [
      { query: `${original} NSE Nifty Sensex ${freshness}`, domains: ['reuters.com', 'nseindia.com', 'livemint.com', 'cnbctv18.com'], maxResults: 6, days: 7 },
      { query: `India stock market institutional flows FII DII rupee crude yields ${freshness}`, maxResults: 5, days: 7 },
      { query: `site:nseindia.com market statistics India ${freshness}`, domains: ['nseindia.com'], maxResults: 3, days: 7 },
    ];
  }
  if (intent === 'mutual_fund_research') {
    return [
      { query: `${original} AMFI official factsheet direct plan benchmark expense ratio portfolio`, domains: ['amfiindia.com'], maxResults: 6, days: 365 },
      { query: `${original} official AMC factsheet scheme information document India`, maxResults: 6, days: 365 },
      { query: `${original} benchmark rolling return riskometer portfolio disclosure`, domains: ['amfiindia.com', 'sebi.gov.in'], maxResults: 5, days: 365 },
    ];
  }
  if (intent === 'sector_analysis' || intent === 'sector_ranking' || intent === 'stock_discovery') {
    return [
      { query: `${subject} outlook growth listed companies latest`, maxResults: 6, days: 365 },
      { query: `${subject} risks demand policy India`, domains: [...OFFICIAL_DOMAINS, ...REPUTABLE_DOMAINS], maxResults: 5, days: 365 },
      { query: `${subject} financial performance market share companies`, domains: ['screener.in', 'moneycontrol.com', 'reuters.com'], maxResults: 5 },
    ];
  }
  return [
    { query: `${original} ${freshness}`, domains: [...OFFICIAL_DOMAINS, ...REPUTABLE_DOMAINS], maxResults: 7, days: 365 },
    { query: `${subject} official filing announcement results`, domains: ['nseindia.com', 'bseindia.com'], maxResults: 5, days: 365 },
  ];
}

function classifyType(url: string, title: string): ResearchSourceMeta['sourceType'] {
  const text = `${url} ${title}`.toLowerCase();
  if (text.includes('nseindia') || text.includes('bseindia') || text.includes('filing') || text.includes('results')) return 'exchange_filing';
  if (text.includes('annual report')) return 'annual_report';
  if (text.includes('investor presentation')) return 'investor_presentation';
  if (text.includes('screener') || text.includes('moneycontrol')) return 'financial_database';
  if (REPUTABLE_DOMAINS.some((domain) => text.includes(domain))) return 'news';
  return 'analysis';
}

function authorityScore(url: string): number {
  const domain = extractDomain(url);
  if (OFFICIAL_DOMAINS.some((item) => domain.includes(item))) return 3;
  if (REPUTABLE_DOMAINS.some((item) => domain.includes(item))) return 2;
  return 1;
}

function toPct(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 1000) / 10;
}

function qualityScore(row: ScreeningResultRow): number {
  return (row.roePct ?? 0) + (row.revenueGrowthPct ?? 0) * 0.5 + (row.earningsGrowthPct ?? 0) * 0.25
    - Math.max(row.debtToEquity ?? 0, 0) * 5 + (row.freeCashFlowCr != null && row.freeCashFlowCr > 0 ? 5 : 0);
}

function structuredQualityScore(row: ScreeningResultRow): number {
  const factors: Array<{ value: number | null; weight: number }> = [
    { value: row.roePct == null ? null : clamp(row.roePct / 25 * 100), weight: 25 },
    { value: row.revenueGrowthPct == null ? null : clamp((row.revenueGrowthPct + 5) / 25 * 100), weight: 25 },
    { value: row.earningsGrowthPct == null ? null : clamp((row.earningsGrowthPct + 10) / 35 * 100), weight: 20 },
    { value: row.debtToEquity == null ? null : clamp((1.5 - row.debtToEquity) / 1.5 * 100), weight: 20 },
    { value: row.freeCashFlowCr == null ? null : row.freeCashFlowCr > 0 ? 85 : 15, weight: 10 },
  ];
  const available = factors.filter((factor) => factor.value != null);
  const weight = available.reduce((sum, factor) => sum + factor.weight, 0);
  return weight ? Math.round(available.reduce((sum, factor) => sum + factor.value! * factor.weight, 0) / weight) : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function describeFilters(filters: ScreeningFilters): string[] {
  const out: string[] = [];
  if (filters.marketCapMinCr != null) out.push(`Market cap ≥ ₹${filters.marketCapMinCr.toLocaleString('en-IN')} Cr`);
  if (filters.marketCapMaxCr != null) out.push(`Market cap ≤ ₹${filters.marketCapMaxCr.toLocaleString('en-IN')} Cr`);
  if (filters.minRevenueGrowthPct != null) out.push(`Revenue growth ≥ ${filters.minRevenueGrowthPct}%`);
  if (filters.minEarningsGrowthPct != null) out.push(`Earnings growth ≥ ${filters.minEarningsGrowthPct}%`);
  if (filters.minRoePct != null) out.push(`ROE ≥ ${filters.minRoePct}%`);
  if (filters.minRocePct != null) out.push(`Requested ROCE ≥ ${filters.minRocePct}% (not applied: unavailable consistently)`);
  if (filters.maxDebtToEquity != null) out.push(`Debt/equity ≤ ${filters.maxDebtToEquity}x`);
  if (filters.minOperatingCashFlowCr != null) out.push(`Operating cash flow ≥ ₹${filters.minOperatingCashFlowCr.toLocaleString('en-IN')} Cr`);
  if (filters.minFreeCashFlowCr != null) out.push(`Free cash flow ≥ ₹${filters.minFreeCashFlowCr.toLocaleString('en-IN')} Cr`);
  if (filters.maxDistanceFrom52WeekLowPct != null) out.push(`Within ${filters.maxDistanceFrom52WeekLowPct}% of 52-week low`);
  if (filters.minInstitutionalHoldingPct != null) out.push(`Institutional holding ≥ ${filters.minInstitutionalHoldingPct}%`);
  if (filters.sector) out.push(`Sector contains “${filters.sector}”`);
  return out.length ? out : ['Ranked using reported growth, ROE, leverage and cash-flow fields'];
}
