import { tavilyExtractWithFallback, tavilySearchWithFallback } from '@/lib/tavily/client';
import { classifySourceType, getDomainAuthority } from './tavily-collector';
import { extractDomain } from '@/lib/formatting/numbers';
import type { CompanyIdentity } from '@/types/company';
import type { ConflictRecord, FinancialMetric, ResearchSourceMeta } from '@/types/research';
import type { ExtractedFinancials } from './metric-extractor';

type MetricKey =
  | 'revenue' | 'ebitda' | 'netProfit' | 'eps' | 'totalDebt' | 'cash'
  | 'totalAssets' | 'totalLiabilities' | 'currentAssets' | 'currentLiabilities'
  | 'shareholdersEquity' | 'equityCapital' | 'reserves' | 'operatingCashFlow' | 'investingCashFlow'
  | 'financingCashFlow' | 'capex' | 'freeCashFlow' | 'currentRatio' | 'quickRatio'
  | 'debtToEquity' | 'interestCoverage' | 'interestExpense' | 'ebit'
  | 'roe' | 'roce' | 'pe' | 'pb' | 'evEbitda' | 'dividendYield'
  | 'promoterHolding' | 'fiiHolding' | 'diiHolding' | 'publicHolding' | 'pledgedHolding';

interface RawEvidence {
  id?: string;
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  sourceType?: ResearchSourceMeta['sourceType'];
  authority?: 'high' | 'medium' | 'low';
}

interface MetricCandidate {
  key: MetricKey;
  value: number;
  unit: string;
  period: string;
  basis: 'Consolidated' | 'Standalone' | 'Unspecified';
  source: RawEvidence;
  metricType: 'reported' | 'calculated';
  formula?: string;
}

interface EnrichmentResult {
  metrics: Partial<ExtractedFinancials>;
  sources: ResearchSourceMeta[];
  conflicts: ConflictRecord[];
  searchesExecuted: number;
  cacheHit: boolean;
}

const cache = new Map<string, { expiresAt: number; value: EnrichmentResult }>();
const inflight = new Map<string, Promise<EnrichmentResult>>();
const usage = { searches: 0, extracts: 0, failures: 0 };

export async function enrichMissingFinancialData(params: {
  company: CompanyIdentity;
  extracted: ExtractedFinancials;
  initialEvidence: RawEvidence[];
  forceRefresh?: boolean;
}): Promise<EnrichmentResult> {
  params.extracted = annotateExistingMetrics(params.extracted, params.initialEvidence);
  const initialTrends = extractHistoricalTrends(params.initialEvidence);
  if (!params.extracted.annualTrend?.length && initialTrends.annual.length) params.extracted.annualTrend = initialTrends.annual;
  if (!params.extracted.quarterlyTrend?.length && initialTrends.quarterly.length) params.extracted.quarterlyTrend = initialTrends.quarterly;
  params.extracted = rejectIncompatibleExtractedValues(params.extracted);
  const initialCandidates = params.initialEvidence.flatMap(parseEvidence);
  const preliminary = selectMetrics(initialCandidates, params.extracted);
  if (!params.extracted.annualTrend?.length && initialTrends.annual.length) preliminary.metrics.annualTrend = initialTrends.annual;
  if (!params.extracted.quarterlyTrend?.length && initialTrends.quarterly.length) preliminary.metrics.quarterlyTrend = initialTrends.quarterly;
  let combined = mergeExtracted(params.extracted, preliminary.metrics);
  combined = rejectIncompatibleExtractedValues(combined);
  combined = deriveCompatibleMetrics(combined, params.company);
  const missingGroups = identifyMissingGroups(combined, params.company);
  if (!missingGroups.length) {
    return { ...preliminary, metrics: combined, searchesExecuted: 0, cacheHit: false };
  }

  const key = `${params.company.exchange}:${params.company.ticker}:${missingGroups.sort().join(',')}`;
  if (params.forceRefresh) cache.delete(key);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, metrics: mergeExtracted(combined, cached.value.metrics), cacheHit: true };
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = performEnrichment(params.company, combined, initialCandidates, missingGroups);
  inflight.set(key, promise);
  try {
    const value = await promise;
    cache.set(key, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value });
    return value;
  } finally {
    inflight.delete(key);
  }
}

function rejectIncompatibleExtractedValues(extracted: ExtractedFinancials): ExtractedFinancials {
  const output = { ...extracted };
  const revenue = metricValue(output.revenue);
  const ebitda = metricValue(output.ebitda);
  const profit = metricValue(output.netProfit);
  if (revenue != null && ((ebitda != null && output.revenue?.period === output.ebitda?.period && revenue <= ebitda)
    || (profit != null && output.revenue?.period === output.netProfit?.period && revenue <= profit))) {
    output.revenue = undefined;
  }
  const latestAnnualRevenue = output.annualTrend?.map((row) => Number(row.revenue) || 0).filter((value) => value > 0).at(-1);
  if (output.revenue && revenue != null && latestAnnualRevenue && /jun|sep|dec|quarter/i.test(output.revenue.period ?? '') && revenue > latestAnnualRevenue * 0.6) {
    output.revenue = undefined;
  }
  if (output.pb && metricValue(output.pb) != null && metricValue(output.pb)! > 100) output.pb = undefined;
  if (output.pe && metricValue(output.pe) != null && metricValue(output.pe)! > 500) output.pe = undefined;
  for (const key of ['promoterHolding', 'fiiHolding', 'diiHolding', 'publicHolding', 'pledgedHolding', 'roe', 'roce', 'dividendYield'] as MetricKey[]) {
    const metric = (output as unknown as Record<string, FinancialMetric | undefined>)[key];
    const value = metricValue(metric);
    if (value != null && (value < 0 || value > (key === 'roe' || key === 'roce' ? 200 : 100))) {
      (output as unknown as Record<string, FinancialMetric | undefined>)[key] = undefined;
    }
  }
  return output;
}

function annotateExistingMetrics(extracted: ExtractedFinancials, evidence: RawEvidence[]): ExtractedFinancials {
  const output = { ...extracted } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(output)) {
    if (!isMetric(value) || value.value == null || value.verificationStatus) continue;
    const source = evidence.find((item) => item.id && item.id === value.sourceId);
    output[key] = {
      ...value,
      sourceName: value.sourceName ?? source?.title ?? null,
      sourceUrl: value.sourceUrl ?? source?.url ?? null,
      publicationDate: value.publicationDate ?? source?.publishedDate ?? null,
      retrievedAt: value.retrievedAt ?? new Date().toISOString(),
      statementType: value.statementType ?? (value.basis === 'Consolidated' ? 'consolidated' : value.basis === 'Standalone' ? 'standalone' : 'unspecified'),
      verificationStatus: value.metricType === 'calculated' ? 'calculated' : 'unverified',
      confidence: value.metricType === 'calculated' ? 'moderate' : source?.authority === 'high' ? 'moderate' : source?.authority === 'medium' ? 'moderate' : 'limited',
    } satisfies FinancialMetric;
  }
  return output as unknown as ExtractedFinancials;
}

async function performEnrichment(
  company: CompanyIdentity,
  extracted: ExtractedFinancials,
  initialCandidates: MetricCandidate[],
  missingGroups: string[],
): Promise<EnrichmentResult> {
  const screener = await fetchStructuredScreenerData(company).catch(() => null);
  const plans = buildSearchPlans(company, missingGroups);
  const searchResults: RawEvidence[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < plans.length; index += 4) {
    const batch = plans.slice(index, index + 4);
    const settled = await Promise.allSettled(batch.map(async (plan) => {
      const response = await withTimeout(tavilySearchWithFallback(plan.query, {
        searchDepth: 'advanced', maxResults: plan.maxResults, includeAnswer: false, includeRawContent: false,
        ...(plan.domains ? { includeDomains: plan.domains } : {}),
        ...(plan.days ? { days: plan.days } : {}),
      }), 20_000);
      usage.searches += 1;
      return response.results ?? [];
    }));
    for (const item of settled) {
      if (item.status === 'rejected') { usage.failures += 1; continue; }
      for (const result of item.value) {
        if (!isValidSourceUrl(result.url) || seen.has(result.url) || !isRelevantToCompany(result.title ?? '', result.content ?? '', company, result.url)) continue;
        seen.add(result.url);
        const domain = extractDomain(result.url);
        searchResults.push({
          url: result.url, title: result.title ?? result.url, content: result.content ?? '',
          publishedDate: result.publishedDate,
          sourceType: classifySourceType(result.url, result.title ?? ''),
          authority: getDomainAuthority(domain),
        });
      }
    }
  }

  const extractUrls = [...searchResults]
    .sort((a, b) => authorityValue(b.authority) - authorityValue(a.authority))
    .filter((item) => /bseindia|nseindia|screener|moneycontrol|annual|investor|result|financial/i.test(`${item.url} ${item.title}`))
    .slice(0, 10)
    .map((item) => item.url);
  if (extractUrls.length) {
    try {
      const response = await withTimeout(tavilyExtractWithFallback(extractUrls), 25_000);
      usage.extracts += 1;
      const extractedMap = new Map((response.results ?? []).map((item) => [item.url, item.rawContent ?? '']));
      for (const item of searchResults) {
        const deep = extractedMap.get(item.url);
        if (deep && deep.length > item.content.length) item.content = deep.slice(0, item.url.includes('screener.in') ? 45_000 : 20_000);
      }
    } catch {
      usage.failures += 1;
    }
  }

  const allCandidates = [...initialCandidates, ...(screener?.candidates ?? []), ...searchResults.flatMap(parseEvidence)];
  const selectionBase: ExtractedFinancials = {
    ...extracted,
    ...(screener?.trends.annual.length ? { annualTrend: screener.trends.annual } : {}),
    ...(screener?.trends.quarterly.length ? { quarterlyTrend: screener.trends.quarterly } : {}),
    ...(screener?.shareholdingHistory.length ? { shareholdingHistory: screener.shareholdingHistory } : {}),
    ...(screener?.noPromoterCategory ? { promoterHolding: { value: null, unit: '%', period: screener.latestShareholdingPeriod, verificationStatus: 'not_applicable', confidence: 'moderate', sourceName: screener.source.title, sourceUrl: screener.source.url, note: 'The retrieved shareholding table does not contain a promoter category; no zero value has been assumed.' } as FinancialMetric } : {}),
  };
  const selected = selectMetrics(allCandidates, selectionBase);
  const trends = screener?.trends ?? extractHistoricalTrends(searchResults);
  if (!extracted.annualTrend?.length && trends.annual.length) selected.metrics.annualTrend = trends.annual;
  if (!extracted.quarterlyTrend?.length && trends.quarterly.length) selected.metrics.quarterlyTrend = trends.quarterly;
  if (trends.annualSource) addSupported(selected.supportedByUrl, trends.annualSource.url, 'Annual financial history');
  if (trends.quarterlySource) addSupported(selected.supportedByUrl, trends.quarterlySource.url, 'Quarterly financial history');
  if (screener?.shareholdingHistory.length) addSupported(selected.supportedByUrl, screener.source.url, 'Historical shareholding pattern');
  let metrics = mergeExtracted(selectionBase, selected.metrics);
  metrics = rejectIncompatibleExtractedValues(metrics);
  metrics = deriveCompatibleMetrics(metrics, company);
  const allEvidence = [...new Map([...searchResults, ...(screener ? [screener.source] : []), ...initialCandidates.map((candidate) => candidate.source)].map((item) => [item.url, item])).values()];
  const sources = buildSources(allEvidence, selected.supportedByUrl);
  console.log(`[financial-enrichment] ${company.ticker}: ${plans.length} targeted searches, ${sources.length} retained sources, usage searches=${usage.searches} extracts=${usage.extracts} failures=${usage.failures}`);
  return {
    metrics,
    sources,
    conflicts: selected.conflicts,
    searchesExecuted: plans.length,
    cacheHit: false,
  };
}

async function fetchStructuredScreenerData(company: CompanyIdentity) {
  const slug = encodeURIComponent(company.screenerSlug ?? company.ticker);
  const urls = [`https://www.screener.in/company/${slug}/consolidated/`, `https://www.screener.in/company/${slug}/`];
  let html = '';
  let sourceUrl = '';
  for (const url of urls) {
    try {
      const response = await withTimeout(fetch(url, { headers: { 'User-Agent': 'Jaro-AI-Research/1.0', Accept: 'text/html' }, cache: 'no-store' }), 15_000);
      console.log(`[screener] fetch ${url} → status ${response.status}`);
      if (!response.ok) continue;
      html = await response.text();
      if (html.includes('id="quarters"') && html.includes('id="balance-sheet"')) { sourceUrl = url; break; }
    } catch (e) { console.warn(`[screener] fetch ${url} failed:`, e instanceof Error ? e.message : e); /* try fallback URL */ }
  }
  if (!html || !sourceUrl) return null;
  console.log(`[screener] Fetched HTML from ${sourceUrl} (${html.length} chars)`);
  const source: RawEvidence = {
    url: sourceUrl,
    title: `${company.name} financial statements — Screener`,
    content: 'Structured financial tables parsed directly from the discovered Screener company page.',
    sourceType: 'financial_database', authority: 'medium',
  };
  const candidates: MetricCandidate[] = [];
  const quarterlyTable = parseHtmlTable(html, 'quarters', 'Consolidated');
  const annualTable = parseHtmlTable(html, 'profit-loss', 'Consolidated');
  const balanceTable = parseHtmlTable(html, 'balance-sheet', 'Consolidated');
  const cashTable = parseHtmlTable(html, 'cash-flow', 'Consolidated');
  const ratioTable = parseHtmlTable(html, 'ratios', 'Consolidated');
  const shareholdingTable = parseHtmlTable(html, 'shareholding', 'Consolidated');
  console.log(`[screener] shareholdingTable=${shareholdingTable ? `${shareholdingTable.rows.size} rows, headers=[${shareholdingTable.headers.join(', ')}]` : 'null'}`);

  if (quarterlyTable) pushLatestRows(quarterlyTable, source, quarterlyTable.basis, candidates, {
    revenue: ['sales', 'revenue from operations'], ebitda: ['operating profit'], netProfit: ['net profit'], eps: ['eps in rs'], interestExpense: ['interest'],
  });
  if (annualTable) pushLatestRows(annualTable, source, annualTable.basis, candidates, {
    revenue: ['sales', 'revenue from operations'], ebitda: ['operating profit'], netProfit: ['net profit'], eps: ['eps in rs'], interestExpense: ['interest'],
  });
  if (balanceTable) pushLatestRows(balanceTable, source, balanceTable.basis, candidates, {
    totalAssets: ['total assets'], totalLiabilities: ['total liabilities'], totalDebt: ['borrowings'],
    equityCapital: ['equity capital'], reserves: ['reserves'],
  });
  if (cashTable) pushLatestRows(cashTable, source, cashTable.basis, candidates, {
    operatingCashFlow: ['cash from operating activity'], investingCashFlow: ['cash from investing activity'],
    financingCashFlow: ['cash from financing activity'], freeCashFlow: ['free cash flow'],
  });
  if (ratioTable) pushLatestRows(ratioTable, source, ratioTable.basis, candidates, { roce: ['roce'] }, '%');
  if (shareholdingTable) pushLatestRows(shareholdingTable, source, shareholdingTable.basis, candidates, {
    promoterHolding: ['promoters', 'promoter', 'promoter group', 'promoter and promoter group'],
    fiiHolding: ['fiis', 'fii', 'foreign institutional', 'foreign portfolio', 'fpi'],
    diiHolding: ['diis', 'dii', 'domestic institutional'],
    publicHolding: ['public', 'public shareholders', 'others'],
    pledgedHolding: ['pledged percentage', 'promoter pledge', 'pledged shares', '% of promoter holding', 'pledging'],
  }, '%');
  const shareholdingCandidates = candidates.filter((c) => ['promoterHolding', 'fiiHolding', 'diiHolding', 'publicHolding', 'pledgedHolding'].includes(c.key));
  console.log(`[screener] Shareholding candidates extracted: ${shareholdingCandidates.map((c) => `${c.key}=${c.value}%`).join(', ') || 'none'}`);
  if (shareholdingTable) console.log(`[screener] shareholdingTable row keys: [${[...shareholdingTable.rows.keys()].join(', ')}]`);
  candidates.push(...parseTopRatiosFromHtml(html, source));
  const annual = annualTable ? buildTrend(annualTable, source, annualTable.basis, false) : [];
  const quarterly = quarterlyTable ? buildTrend(quarterlyTable, source, quarterlyTable.basis, true) : [];
  const shareholdingHistory = shareholdingTable ? buildShareholdingHistory(shareholdingTable, source) : [];
  const noPromoterCategory = Boolean(shareholdingTable && !findRow(shareholdingTable.rows, ['promoters', 'promoter']));
  return {
    source,
    candidates,
    shareholdingHistory,
    noPromoterCategory,
    latestShareholdingPeriod: shareholdingTable?.headers.at(-1) ? clarifyPeriod(shareholdingTable.headers.at(-1)!, 'quarterly') : null,
    trends: { annual, quarterly, annualSource: annual.length ? source : undefined, quarterlySource: quarterly.length ? source : undefined },
  };
}

function buildShareholdingHistory(table: ParsedTable, source: RawEvidence): NonNullable<ExtractedFinancials['shareholdingHistory']> {
  const promoter = findRow(table.rows, ['promoters', 'promoter']);
  const fii = findRow(table.rows, ['fiis', 'fii']);
  const dii = findRow(table.rows, ['diis', 'dii']);
  const publicHolding = findRow(table.rows, ['public']);
  return table.headers.map((period, index) => ({
    period: clarifyPeriod(period, table.periodType), promoter: promoter?.[index] ?? null, fii: fii?.[index] ?? null,
    dii: dii?.[index] ?? null, public: publicHolding?.[index] ?? null,
    sourceId: sourceIdFor(source.url), basis: table.basis,
  })).filter((row) => [row.promoter, row.fii, row.dii, row.public].some((value) => value != null && value >= 0 && value <= 100)).slice(-12);
}

function parseHtmlTable(html: string, sectionId: string, preferredBasis: MetricCandidate['basis']): ParsedTable | null {
  const section = html.match(new RegExp(`<section[^>]+id=["']${escapeRegex(sectionId)}["'][^>]*>([\\s\\S]*?)<\\/section>`, 'i'))?.[1];
  if (!section) return null;
  const tableHtml = section.match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!tableHtml) return null;
  const rowHtml = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  if (rowHtml.length < 2) return null;
  const cellValues = (row: string) => [...row.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((match) => cleanHtml(match[1]));
  const headers = cellValues(rowHtml[0]).slice(1);
  const rows = new Map<string, Array<number | null>>();
  for (const row of rowHtml.slice(1)) {
    const cells = cellValues(row);
    if (cells.length < 2) continue;
    rows.set(normalizeLabel(cells[0]), cells.slice(1).map(parseNumber));
  }
  const text = cleanHtml(section.slice(0, section.indexOf('<table'))).toLowerCase();
  const basis: MetricCandidate['basis'] = text.includes('standalone') && !text.includes('view standalone') ? 'Standalone'
    : text.includes('consolidated') || sourceLooksConsolidated(html) ? preferredBasis : 'Unspecified';
  const periodType: ParsedTable['periodType'] = sectionId === 'quarters' || sectionId === 'shareholding' ? 'quarterly'
    : sectionId === 'profit-loss' || sectionId === 'cash-flow' || sectionId === 'ratios' ? 'annual'
      : sectionId === 'balance-sheet' ? 'balance' : 'other';
  return headers.length && rows.size ? { headers, rows, basis, periodType } : null;
}

function parseTopRatiosFromHtml(html: string, source: RawEvidence): MetricCandidate[] {
  const block = html.match(/<ul[^>]+id=["']top-ratios["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? '';
  const items = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => cleanHtml(match[1]));
  const output: MetricCandidate[] = [];
  const mappings: Array<[MetricKey, RegExp, string]> = [
    ['pe', /stock p\/?e\s*([0-9,.]+)/i, 'x'], ['dividendYield', /dividend yield\s*([0-9,.]+)/i, '%'],
    ['roce', /roce\s*([0-9,.]+)/i, '%'], ['roe', /roe\s*([0-9,.]+)/i, '%'],
  ];
  for (const text of items) for (const [key, pattern, unit] of mappings) {
    const value = parseNumber(text.match(pattern)?.[1]);
    if (value != null) output.push({ key, value, unit, period: 'Latest value displayed by Screener; calculation date not separately stated', basis: 'Consolidated', source, metricType: 'reported' });
  }
  const price = parseNumber(items.find((item) => /current price/i.test(item))?.match(/current price\s*₹?\s*([0-9,.]+)/i)?.[1]);
  const book = parseNumber(items.find((item) => /book value/i.test(item))?.match(/book value\s*₹?\s*([0-9,.]+)/i)?.[1]);
  if (price != null && book != null && book !== 0) output.push({ key: 'pb', value: Math.round((price / book) * 100) / 100, unit: 'x', period: 'Latest value displayed by Screener; calculation date not separately stated', basis: 'Consolidated', source, metricType: 'calculated', formula: 'Current Price / Book Value per share' });
  return output;
}

function cleanHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#x20b9;|&#8377;/gi, '₹')
    .replace(/&minus;|&#8722;/gi, '-').replace(/\s+/g, ' ').trim();
}

function sourceLooksConsolidated(html: string) {
  return /<link[^>]+canonical[^>]+\/consolidated\//i.test(html);
}

function buildSearchPlans(company: CompanyIdentity, groups: string[]) {
  const identity = `"${company.name}" ${company.exchange} ${company.ticker}`;
  const currentYears = 'FY2025 FY2026 FY2027 latest';
  const plans: Array<{ query: string; domains?: string[]; maxResults: number; days?: number }> = [];
  if (groups.includes('performance')) {
    plans.push(
      { query: `${identity} latest quarterly results revenue operating profit net profit EPS ${currentYears}`, domains: ['bseindia.com', 'nseindia.com'], maxResults: 5, days: 730 },
      { query: `${identity} consolidated annual financial statements five year sales profit history site:screener.in/company`, domains: ['screener.in', 'moneycontrol.com'], maxResults: 5 },
    );
  }
  if (groups.includes('balance_sheet')) {
    plans.push(
      { query: `${identity} balance sheet total assets liabilities borrowings cash reserves shareholders equity ${currentYears}`, domains: ['bseindia.com', 'nseindia.com'], maxResults: 5, days: 730 },
      { query: `${identity} current assets current liabilities balance sheet consolidated`, domains: ['screener.in', 'moneycontrol.com'], maxResults: 5 },
    );
  }
  if (groups.includes('cash_flow')) {
    plans.push(
      { query: `${identity} cash flow statement operating investing financing cash flow capex free cash flow ${currentYears}`, maxResults: 6, days: 730 },
    );
  }
  if (groups.includes('ratios')) {
    plans.push(
      { query: `${identity} debt equity current ratio interest coverage ROE ROCE operating margin net margin ${currentYears}`, domains: ['screener.in', 'moneycontrol.com', 'trendlyne.com'], maxResults: 6 },
      { query: `${identity} PE PB EV EBITDA dividend yield valuation ratios latest`, domains: ['screener.in', 'moneycontrol.com', 'trendlyne.com'], maxResults: 5, days: 365 },
    );
  }
  if (groups.includes('shareholding')) {
    const ticker = company.ticker;
    const name = company.name;
    // Use Screener.in as the primary source — it has well-structured shareholding tables
    // Moneycontrol & Trendlyne as secondary. BSE/NSE for official quarterly disclosures.
    plans.push(
      // Primary: Screener shareholding page (always available, well-structured)
      { query: `${ticker} ${name} shareholding pattern promoter FII DII public pledged site:screener.in`, domains: ['screener.in'], maxResults: 3 },
      // Secondary: Moneycontrol & Trendlyne (rich text format, good regex targets)
      { query: `"${name}" OR "${ticker}" promoter holding FII DII public shareholding pattern latest quarter 2025 2026`, domains: ['moneycontrol.com', 'trendlyne.com', 'tickertape.in'], maxResults: 5, days: 365 },
      // Tertiary: BSE/NSE official filings
      { query: `${ticker} ${name} shareholding pattern September December March June 2026 promoter FII DII`, domains: ['bseindia.com', 'nseindia.com'], maxResults: 4, days: 365 },
      // Quaternary: General news mentions that contain shareholding numbers
      { query: `${name} promoter holds % stake FII DII shareholding 2025 2026`, maxResults: 4, days: 365 },
    );
  }
  return plans;
}

function identifyMissingGroups(metrics: ExtractedFinancials, company: CompanyIdentity): string[] {
  const groups: string[] = [];
  if (!metrics.revenue || !metrics.netProfit || !metrics.ebitda || !metrics.annualTrend?.length || !metrics.quarterlyTrend?.length) groups.push('performance');
  if (!metrics.totalAssets || !metrics.totalLiabilities || !metrics.shareholdersEquity || !metrics.cash || !metrics.totalDebt) groups.push('balance_sheet');
  if (!metrics.operatingCashFlow || !metrics.freeCashFlow || !metrics.capex) groups.push('cash_flow');
  const financial = /bank|financial|nbfc|insurance/i.test(`${company.sector} ${company.industry}`);
  if ((!financial && !metrics.debtToEquity) || !metrics.currentRatio || !metrics.interestCoverage || !metrics.roe || !metrics.roce || !metrics.pe || !metrics.pb || !metrics.evEbitda) groups.push('ratios');
  if (!metrics.promoterHolding || !metrics.fiiHolding || !metrics.diiHolding || !metrics.publicHolding) groups.push('shareholding');
  return groups;
}

function parseEvidence(source: RawEvidence): MetricCandidate[] {
  if (!source.content) return [];
  const candidates: MetricCandidate[] = [];
  const basis = detectBasis(source.content);
  parsePerformanceTables(source, basis, candidates);
  parseLatestTableMetrics(source, basis, candidates);
  parseStatementPatterns(source, basis, candidates);
  parseRatioPatterns(source, basis, candidates);
  return candidates;
}

function parseStatementPatterns(source: RawEvidence, basis: MetricCandidate['basis'], output: MetricCandidate[]) {
  const patterns: Array<[MetricKey, RegExp]> = [
    ['revenue', /(?:revenue from operations|revenue|sales)\s*(?:was|were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['netProfit', /(?:net profit|profit after tax|PAT)\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['ebitda', /(?:EBITDA|operating profit)\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['totalAssets', /total assets\s*(?:were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['totalLiabilities', /total liabilities\s*(?:were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['currentAssets', /current assets\s*(?:were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['currentLiabilities', /current liabilities\s*(?:were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['totalDebt', /(?:total debt|total borrowings|borrowings)\s*(?:were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['cash', /(?:cash and cash equivalents|cash equivalents|cash balance)\s*(?:were|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['shareholdersEquity', /(?:shareholders'? equity|total equity|net worth)\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['operatingCashFlow', /(?:cash (?:flow )?from operating activities|operating cash flow)\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['freeCashFlow', /free cash flow\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['capex', /(?:capital expenditure|capex)\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['interestExpense', /(?:interest expense|finance costs?)\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
    ['ebit', /\bEBIT\b\s*(?:was|stood at|of|:|\|)?\s*(?:₹|rs\.?|inr)?\s*([0-9,.]+)\s*(crore|cr|lakh|million|billion)/i],
  ];
  for (const [key, pattern] of patterns) {
    const match = source.content.match(pattern);
    if (!match) continue;
    const raw = parseNumber(match[1]);
    if (raw == null) continue;
    output.push({ key, value: toCrore(raw, match[2]), unit: '₹ Cr', period: periodFromSource(source), basis, source, metricType: 'reported' });
  }
}

function parsePerformanceTables(source: RawEvidence, basis: MetricCandidate['basis'], output: MetricCandidate[]) {
  const quarterly = parseMarkdownSection(source.content, ['Quarterly Results', 'Quarterly results']);
  if (quarterly) {
    pushLatestRows(quarterly, source, quarterly.basis, output, {
      revenue: ['sales', 'revenue from operations', 'revenue'], ebitda: ['operating profit', 'ebitda'],
      netProfit: ['net profit', 'profit after tax', 'pat'], eps: ['eps in rs', 'eps'],
    });
  }
  const annual = parseMarkdownSection(source.content, ['Profit & Loss', 'Profit and Loss', 'Statement of Profit and Loss']);
  if (annual) {
    pushLatestRows(annual, source, annual.basis, output, {
      revenue: ['sales', 'revenue from operations'], ebitda: ['operating profit', 'ebitda'],
      netProfit: ['net profit', 'profit after tax'], eps: ['eps in rs', 'eps'], interestExpense: ['interest', 'finance costs'],
    });
  }
}

function extractHistoricalTrends(evidence: RawEvidence[]) {
  let annual: NonNullable<ExtractedFinancials['annualTrend']> = [];
  let quarterly: NonNullable<ExtractedFinancials['quarterlyTrend']> = [];
  let annualSource: RawEvidence | undefined;
  let quarterlySource: RawEvidence | undefined;
  const trendScore = (source: RawEvidence) => (source.url.includes('screener.in/company/') ? 100 : 0) + authorityValue(source.authority);
  const ranked = [...evidence].sort((a, b) => trendScore(b) - trendScore(a));
  for (const source of ranked) {
    if (!annual.length) {
      const table = parseMarkdownSection(source.content, ['Profit & Loss', 'Profit and Loss', 'Statement of Profit and Loss']);
      if (table) {
        annual = buildTrend(table, source, table.basis, false);
        if (annual.length) annualSource = source;
      }
    }
    if (!quarterly.length) {
      const table = parseMarkdownSection(source.content, ['Quarterly Results', 'Quarterly results']);
      if (table) {
        quarterly = buildTrend(table, source, table.basis, true);
        if (quarterly.length) quarterlySource = source;
      }
    }
    if (annual.length && quarterly.length) break;
  }
  return { annual, quarterly, annualSource, quarterlySource };
}

function buildTrend(table: ParsedTable, source: RawEvidence, basis: MetricCandidate['basis'], quarterly: boolean) {
  const revenue = findRow(table.rows, [
    'sales', 'revenue from operations', 'revenue', 'total revenue', 'total income',
    'income from operations', 'gross revenue', 'turnover', 'gross sales',
  ]);
  const operatingProfit = findRow(table.rows, [
    'operating profit', 'ebitda', 'ebit', 'operating profit ebitda',
    'profit before interest and tax', 'pbit',
  ]);
  const profit = findRow(table.rows, [
    'net profit', 'profit after tax', 'pat', 'net profit loss',
    'profit for the period', 'profit for the year', 'consolidated net profit',
    'profit loss for the period',
  ]);
  const eps = findRow(table.rows, ['eps in rs', 'eps', 'basic eps', 'diluted eps']);
  const sourceId = sourceIdFor(source.url);
  const rows = table.headers.map((header, index) => {
    let revenueValue = revenue?.[index] ?? null;
    const operatingValue = operatingProfit?.[index] ?? null;
    let profitValue = profit?.[index] ?? null;
    // Only nullify revenue if it is clearly nonsensical (negative or zero while operating profit is large and positive)
    if (revenueValue != null && operatingValue != null && revenueValue <= 0 && operatingValue > 0) revenueValue = null;
    if (revenueValue != null && profitValue != null && revenueValue <= 0 && profitValue > 0) revenueValue = null;
    return {
      period: clarifyPeriod(header, quarterly ? 'quarterly' : 'annual'),
      revenue: revenueValue,
      operatingProfit: operatingValue,
      ebitda: operatingValue,
      profit: profitValue,
      eps: eps?.[index] ?? null,
      sourceId,
      basis,
    };
  }).filter((row) => row.revenue != null || row.profit != null || row.operatingProfit != null || row.ebitda != null);
  return rows.slice(quarterly ? -12 : -8);
}

function parseLatestTableMetrics(source: RawEvidence, basis: MetricCandidate['basis'], output: MetricCandidate[]) {
  const balance = parseMarkdownSection(source.content, ['Balance Sheet', 'Balance sheet']);
  if (balance) pushLatestRows(balance, source, balance.basis, output, {
    totalAssets: ['total assets'], totalLiabilities: ['total liabilities'], currentAssets: ['current assets'],
    currentLiabilities: ['current liabilities'], totalDebt: ['borrowings', 'total debt'], cash: ['cash equivalents', 'cash and cash equivalents', 'cash balance'],
    reserves: ['reserves', 'reserves and surplus'], shareholdersEquity: ['shareholders equity', 'total equity', 'net worth'],
    equityCapital: ['equity capital', 'share capital'],
  });
  const cashFlow = parseMarkdownSection(source.content, ['Cash Flows', 'Cash Flow', 'Cash flow statement']);
  if (cashFlow) pushLatestRows(cashFlow, source, cashFlow.basis, output, {
    operatingCashFlow: ['cash from operating activity', 'operating cash flow', 'net cash from operating'],
    investingCashFlow: ['cash from investing activity', 'investing cash flow', 'net cash used in investing'],
    financingCashFlow: ['cash from financing activity', 'financing cash flow', 'net cash from financing'],
    capex: ['capital expenditure', 'purchase of property plant', 'fixed assets purchased'],
  });
  const shareholding = parseMarkdownSection(source.content, ['Shareholding Pattern', 'Shareholding pattern', 'Shareholding']);
  if (shareholding) pushLatestRows(shareholding, source, shareholding.basis, output, {
    promoterHolding: ['promoters', 'promoter', 'promoter group', 'promoter and promoter group'],
    fiiHolding: ['fiis', 'fii', 'foreign institutional', 'foreign portfolio', 'fpi'],
    diiHolding: ['diis', 'dii', 'domestic institutional'],
    publicHolding: ['public', 'public shareholders'],
    pledgedHolding: ['pledged percentage', 'promoter pledge', 'pledged', 'pledging'],
  }, '%');
}

function parseRatioPatterns(source: RawEvidence, basis: MetricCandidate['basis'], output: MetricCandidate[]) {
  const patterns: Array<[MetricKey, RegExp, string]> = [
    ['debtToEquity', /debt\s*(?:to|\/)\s*equity(?:\s*ratio)?\s*[:|]?\s*([0-9,.]+)\s*(?:x|times)?/i, 'x'],
    ['currentRatio', /current\s*ratio\s*[:|]?\s*([0-9,.]+)\s*(?:x|times)?/i, 'x'],
    ['quickRatio', /quick\s*ratio\s*[:|]?\s*([0-9,.]+)\s*(?:x|times)?/i, 'x'],
    ['interestCoverage', /interest\s*coverage(?:\s*ratio)?\s*[:|]?\s*([0-9,.]+)\s*(?:x|times)?/i, 'x'],
    ['roe', /(?:return on equity|ROE)\s*[:|]?\s*([0-9,.]+)\s*%/i, '%'],
    ['roce', /(?:return on capital employed|ROCE)\s*[:|]?\s*([0-9,.]+)\s*%/i, '%'],
    ['pe', /(?:stock\s*)?P\s*\/\s*E(?:\s*ratio)?\s*[:|]?\s*([0-9,.]+)\s*(?:x)?/i, 'x'],
    ['pb', /P\s*\/\s*B(?:\s*ratio)?\s*[:|]?\s*([0-9,.]+)\s*(?:x)?/i, 'x'],
    ['evEbitda', /EV\s*\/\s*EBITDA\s*[:|]?\s*([0-9,.]+)\s*(?:x)?/i, 'x'],
    ['dividendYield', /dividend\s*yield\s*[:|]?\s*([0-9,.]+)\s*%/i, '%'],
    // ── Shareholding patterns ─────────────────────────────────────────
    // Table row format: "Promoters | 72.34" or "Promoter : 72.34%"
    ['promoterHolding', /(?:^|\|)\s*Promoters?\s*(?:\||:)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/im, '%'],
    ['promoterHolding', /Promoter(?:s)?(?:\s+(?:holding|stake|group))?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    ['promoterHolding', /Promoter\s+Holding[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    // Screener.in table format: "Promoters 72.08 72.08 72.08" (space-separated columns)
    ['promoterHolding', /^promoters?\s+(\d+\.?\d*)\s+(\d+\.?\d*)/im, '%'],
    // Moneycontrol format: "Promoter & Promoter Group: 50.5%"
    ['promoterHolding', /promoter[s]?\s*&?\s*promoter\s*group[:\s]+(\d+\.?\d*)%?/i, '%'],
    ['fiiHolding', /(?:^|\|)\s*FIIs?\s*(?:\||:)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/im, '%'],
    ['fiiHolding', /FII\s*(?:Holding|holding)?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    ['fiiHolding', /Foreign\s+Institutional\s+Investors?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    ['fiiHolding', /Foreign\s+Portfolio\s+Investors?\s*(?:\(FPI\))?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    // FII shorthand without colon: "FII / FPI 15.3%"
    ['fiiHolding', /\bFII\s*\/?\s*FPI[:\s]+(\d+\.?\d*)%?/i, '%'],
    ['diiHolding', /(?:^|\|)\s*DIIs?\s*(?:\||:)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/im, '%'],
    ['diiHolding', /DII\s*(?:Holding|holding)?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    ['diiHolding', /Domestic\s+Institutional\s+Investors?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    // DII shorthand without colon: "Domestic Institutional 8.2%"
    ['diiHolding', /domestic\s+institutional[:\s]+(\d+\.?\d*)%?/i, '%'],
    ['publicHolding', /(?:^|\|)\s*Public\s*(?:\||:)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/im, '%'],
    ['publicHolding', /Public\s*(?:Holding|holding|shareholders?)?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
    ['pledgedHolding', /Pledged\s*(?:percentage|shares?|%|holding)?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i, '%'],
    ['pledgedHolding', /Promoter(?:s)?\s+Pledge[sd]?\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, '%'],
  ];
  for (const [key, pattern, unit] of patterns) {
    const match = source.content.match(pattern);
    const value = match ? parseNumber(match[1]) : null;
    if (value != null) output.push({ key, value, unit, period: periodFromSource(source), basis, source, metricType: 'reported' });
  }

  // Enhanced multi-column table line parser for shareholding
  const contentLines = source.content.split('\n');
  for (const rawLine of contentLines) {
    const line = rawLine.trim();
    if (!line || (!line.includes('|') && !line.includes('%'))) continue;
    const nums = [...line.matchAll(/(?:\b|\|)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|\||\s|$)/g)]
      .map((m) => parseNumber(m[1]))
      .filter((n): n is number => n != null && n >= 0 && n <= 100);
    if (!nums.length) continue;
    const latestValue = nums[nums.length - 1];

    if (/^(?:\||#|\*|\s)*(?:promoter|promoters\s*\+|promoter\s*group|promoter\s*&\s*promoter\s*group)/i.test(line)) {
      output.push({ key: 'promoterHolding', value: latestValue, unit: '%', period: periodFromSource(source), basis, source, metricType: 'reported' });
    } else if (/^(?:\||#|\*|\s)*(?:fii|fiis|foreign\s*portfolio|foreign\s*institutional|fpi)/i.test(line)) {
      output.push({ key: 'fiiHolding', value: latestValue, unit: '%', period: periodFromSource(source), basis, source, metricType: 'reported' });
    } else if (/^(?:\||#|\*|\s)*(?:dii|diis|domestic\s*institutional|mutual\s*funds)/i.test(line)) {
      output.push({ key: 'diiHolding', value: latestValue, unit: '%', period: periodFromSource(source), basis, source, metricType: 'reported' });
    } else if (/^(?:\||#|\*|\s)*(?:public|others|retail|non-institutional)/i.test(line) && !/interest|coverage|sales|profit|debt/i.test(line)) {
      output.push({ key: 'publicHolding', value: latestValue, unit: '%', period: periodFromSource(source), basis, source, metricType: 'reported' });
    } else if (/(?:pledged|promoter\s*pledge|encumbered)/i.test(line)) {
      output.push({ key: 'pledgedHolding', value: latestValue, unit: '%', period: periodFromSource(source), basis, source, metricType: 'reported' });
    }
  }
  const extendedPatterns: Array<[MetricKey, RegExp, string]> = [
    ['debtToEquity', /debt\s*(?:to|\s)\s*equity\s*ratio[\s\S]{0,180}?\b([0-9]+(?:\.[0-9]+)?)\b/i, 'x'],
    ['currentRatio', /current\s*ratio[\s\S]{0,180}?\b([0-9]+(?:\.[0-9]+)?)\b/i, 'x'],
    ['interestCoverage', /interest\s*(?:service\s*)?coverage\s*ratio[\s\S]{0,180}?\b([0-9]+(?:\.[0-9]+)?)\b/i, 'x'],
  ];
  for (const [key, pattern, unit] of extendedPatterns) {
    if (output.some((item) => item.key === key)) continue;
    const value = parseNumber(source.content.match(pattern)?.[1]);
    if (value != null) output.push({ key, value, unit, period: periodFromSource(source), basis, source, metricType: 'reported' });
  }
}

interface ParsedTable { headers: string[]; rows: Map<string, Array<number | null>>; basis: MetricCandidate['basis']; periodType: 'quarterly' | 'annual' | 'balance' | 'other' }

function parseMarkdownSection(content: string, headings: string[]): ParsedTable | null {
  let section = '';
  let matchedHeading = '';
  for (const heading of headings) {
    const pattern = new RegExp(`(?:#{1,4}\\s*|\\*\\*)${escapeRegex(heading)}(?:\\*\\*)?([\\s\\S]*?)(?=\\n#{1,4}\\s+|\\n\\*\\*|$)`, 'i');
    section = content.match(pattern)?.[1] ?? '';
    if (section) { matchedHeading = heading; break; }
  }
  if (!section) return null;
  const lines = section.split('\n').filter((line) => line.trim().startsWith('|'));
  if (lines.length < 3) return null;
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const headers = cells(lines[0]).slice(1);
  const rows = new Map<string, Array<number | null>>();
  for (const line of lines.slice(1)) {
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue;
    const values = cells(line);
    if (values.length < 2) continue;
    rows.set(normalizeLabel(values[0]), values.slice(1).map(parseNumber));
  }
  const preamble = section.slice(0, Math.max(0, section.indexOf('|'))).toLowerCase();
  const basis: MetricCandidate['basis'] = preamble.includes('standalone') ? 'Standalone' : preamble.includes('consolidated') ? 'Consolidated' : 'Unspecified';
  const periodType: ParsedTable['periodType'] = /quarter|shareholding/i.test(matchedHeading) ? 'quarterly'
    : /profit|cash flow|ratio/i.test(matchedHeading) ? 'annual'
      : /balance/i.test(matchedHeading) ? 'balance' : 'other';
  return headers.length && rows.size ? { headers, rows, basis, periodType } : null;
}

function pushLatestRows(
  table: ParsedTable,
  source: RawEvidence,
  basis: MetricCandidate['basis'],
  output: MetricCandidate[],
  mappings: Partial<Record<MetricKey, string[]>>,
  forcedUnit?: string,
) {
  for (const [key, aliases] of Object.entries(mappings) as Array<[MetricKey, string[]]>) {
    const found = findRow(table.rows, aliases);
    if (!found) continue;
    const index = lastNumericIndex(found);
    if (index < 0 || found[index] == null) continue;
    const period = clarifyPeriod(table.headers[index] ?? periodFromSource(source), table.periodType);
    const unit = forcedUnit ?? (isRatioKey(key) ? ratioUnit(key) : '₹ Cr');
    output.push({ key, value: found[index]!, unit, period, basis, source, metricType: 'reported' });
  }
}

function selectMetrics(candidates: MetricCandidate[], existing: ExtractedFinancials) {
  const metrics: Partial<ExtractedFinancials> = {};
  const conflicts: ConflictRecord[] = [];
  const supportedByUrl = new Map<string, Set<string>>();
  const groups = new Map<MetricKey, MetricCandidate[]>();
  for (const candidate of candidates) {
    if (!groups.has(candidate.key)) groups.set(candidate.key, []);
    groups.get(candidate.key)!.push(candidate);
  }
  for (const [key, items] of groups) {
    let ranked = items.filter(isPlausibleCandidate).sort((a, b) => candidateScore(b) - candidateScore(a));
    if (key === 'revenue') {
      const annualRevenue = existing.annualTrend?.map((row) => Number(row.revenue) || 0).filter((value) => value > 0).at(-1);
      if (annualRevenue) ranked = ranked.filter((item) => !/quarter|jun|sep|dec/i.test(item.period) || item.value <= annualRevenue * 0.6);
    }
    const current = (existing as unknown as Record<string, unknown>)[key] as FinancialMetric | undefined;
    if (hasMetric(existing, key) && current) {
      const currentValue = metricValue(current)!;
      let primary = ranked.find((item) => item.source.authority === 'high' && !item.period.includes('exact period not parsed') && candidateCompatibleWithMetric(item, current));
      if (!primary && current.period?.includes('exact period not parsed')) {
        primary = ranked.find((item) => item.source.url.includes('screener.in/company/') && !item.period.includes('exact period not parsed'));
      }
      const independentMatch = ranked.find((item) => item.source.url !== current.sourceUrl && candidateCompatibleWithMetric(item, current) && relativeDifference(item.value, currentValue) <= 0.05);
      if (!primary && independentMatch) {
        (metrics as Record<string, unknown>)[key] = {
          ...current,
          verificationStatus: 'cross_checked',
          confidence: current.confidence === 'limited' ? 'moderate' : current.confidence ?? 'moderate',
          note: `Corroborated by ${independentMatch.source.title}; original source retained.`,
        } satisfies FinancialMetric;
        if (current.sourceUrl) addSupported(supportedByUrl, current.sourceUrl, key);
        addSupported(supportedByUrl, independentMatch.source.url, key);
        continue;
      }
      if (!primary) continue;
      if (relativeDifference(primary.value, currentValue) > 0.05) {
        conflicts.push({
          metric: humanMetric(key), selectedValue: primary.value, selectedSource: primary.source.title,
          conflictingValues: [{ value: currentValue, source: current.sourceName ?? current.sourceUrl ?? 'Initial extraction', basis: current.basis }],
          resolution: 'Authoritative filing candidate replaced a materially different secondary/initial extraction.',
        });
      }
      // Continue through normal selection with the primary filing ranked first.
      ranked.splice(ranked.indexOf(primary), 1);
      ranked.unshift(primary);
    }
    const selected = ranked[0];
    if (!selected) continue;
    const comparable = ranked.filter((item) => item !== selected && compatible(item, selected));
    const corroborating = comparable.find((item) => relativeDifference(item.value, selected.value) <= 0.05);
    const conflicting = comparable.filter((item) => relativeDifference(item.value, selected.value) > 0.05);
    const sourceId = sourceIdFor(selected.source.url);
    const periodReliable = !selected.period.includes('exact period not parsed');
    const verificationStatus: FinancialMetric['verificationStatus'] = corroborating && periodReliable ? 'cross_checked' : selected.source.authority === 'high' && periodReliable ? 'verified' : 'unverified';
    const metric: FinancialMetric = {
      value: selected.value, unit: selected.unit, period: selected.period, basis: selected.basis,
      sourceId, metricType: selected.metricType, formula: selected.formula ?? null,
      currency: selected.unit.includes('₹') ? 'INR' : null,
      statementType: selected.basis === 'Consolidated' ? 'consolidated' : selected.basis === 'Standalone' ? 'standalone' : 'unspecified',
      sourceName: selected.source.title, sourceUrl: selected.source.url,
      publicationDate: selected.source.publishedDate ?? null, retrievedAt: new Date().toISOString(),
      verificationStatus, confidence: periodReliable && (corroborating || selected.source.authority === 'high') ? 'high' : selected.source.authority === 'medium' ? 'moderate' : 'limited',
      note: verificationStatus === 'unverified' ? 'Found in one secondary source; review original source before relying on this value.' : null,
    };
    (metrics as Record<string, unknown>)[key] = metric;
    addSupported(supportedByUrl, selected.source.url, key);
    if (corroborating) addSupported(supportedByUrl, corroborating.source.url, key);
    if (conflicting.length) {
      conflicts.push({
        metric: humanMetric(key), selectedValue: selected.value,
        selectedSource: selected.source.title,
        conflictingValues: conflicting.slice(0, 3).map((item) => ({ value: item.value, source: item.source.title, basis: item.basis })),
        resolution: selected.source.authority === 'high'
          ? 'Primary/authoritative source selected; secondary discrepancy retained for review.'
          : 'Highest-ranked available source selected provisionally; discrepancy disclosed because no primary filing candidate was parsed.',
      });
    }
  }
  return { metrics, conflicts, supportedByUrl, sources: [] as ResearchSourceMeta[], searchesExecuted: 0, cacheHit: false };
}

function deriveCompatibleMetrics(metrics: ExtractedFinancials, company: CompanyIdentity): ExtractedFinancials {
  const output = { ...metrics };
  const financial = /bank|financial|nbfc|insurance/i.test(`${company.sector} ${company.industry}`);
  const derivedEquity = compatibleMetrics(output.equityCapital, output.reserves)
    ? calculatedMetric(metricValue(output.equityCapital)! + metricValue(output.reserves)!, '₹ Cr', output.equityCapital!, 'Equity Capital + Reserves', 'Shareholders Equity')
    : undefined;
  if ((!output.shareholdersEquity || output.shareholdersEquity.period?.includes('exact period not parsed')) && derivedEquity) output.shareholdersEquity = derivedEquity;
  const derivedDebtEquity = !financial ? calculateRatio('Debt to Equity', output.totalDebt, output.shareholdersEquity, 'x', 'Total Debt / Shareholders Equity') : undefined;
  if ((!output.debtToEquity || output.debtToEquity.verificationStatus === 'unverified') && derivedDebtEquity) output.debtToEquity = derivedDebtEquity;
  const derivedCurrentRatio = calculateRatio('Current Ratio', output.currentAssets, output.currentLiabilities, 'x', 'Current Assets / Current Liabilities');
  if ((!output.currentRatio || output.currentRatio.verificationStatus === 'unverified') && derivedCurrentRatio) output.currentRatio = derivedCurrentRatio;
  const derivedCoverage = calculateRatio('Interest Coverage', output.ebit, output.interestExpense, 'x', 'EBIT / Interest Expense');
  if ((!output.interestCoverage || output.interestCoverage.verificationStatus === 'unverified') && derivedCoverage) output.interestCoverage = derivedCoverage;
  if (!output.freeCashFlow && compatibleMetrics(output.operatingCashFlow, output.capex)) {
    const ocf = metricValue(output.operatingCashFlow)!;
    const capex = Math.abs(metricValue(output.capex)!);
    output.freeCashFlow = calculatedMetric(ocf - capex, '₹ Cr', output.operatingCashFlow!, 'Operating Cash Flow - Capital Expenditure');
  }
  if (!output.workingCapital && compatibleMetrics(output.currentAssets, output.currentLiabilities)) {
    output.workingCapital = calculatedMetric(metricValue(output.currentAssets)! - metricValue(output.currentLiabilities)!, '₹ Cr', output.currentAssets!, 'Current Assets - Current Liabilities');
  }
  if (financial && !output.debtToEquity) {
    output.debtToEquity = { value: null, unit: 'x', period: null, verificationStatus: 'not_applicable', confidence: 'high', note: 'Corporate debt/equity is not comparable for banks, NBFCs or insurers; use sector-specific capital and asset-quality measures.' };
  }
  const ownershipKnown = [output.promoterHolding, output.fiiHolding, output.diiHolding]
    .map(metricValue).filter((value): value is number => value != null).reduce((sum, value) => sum + value, 0);
  if (metricValue(output.publicHolding) === 0 && ownershipKnown < 95) output.publicHolding = undefined;
  return output;
}

function calculateRatio(name: string, numerator?: FinancialMetric, denominator?: FinancialMetric, unit = 'x', formula = ''): FinancialMetric | undefined {
  if (!compatibleMetrics(numerator, denominator)) return undefined;
  const n = metricValue(numerator)!; const d = metricValue(denominator)!;
  if (d === 0) return undefined;
  return calculatedMetric(n / d, unit, numerator!, formula, name);
}

function calculatedMetric(value: number, unit: string, source: FinancialMetric, formula: string, name?: string): FinancialMetric {
  return {
    value: Math.round(value * 100) / 100, unit, period: source.period, basis: source.basis,
    sourceId: source.sourceId, sourceName: source.sourceName, sourceUrl: source.sourceUrl,
    metricType: 'calculated', formula, verificationStatus: 'calculated', confidence: source.confidence ?? 'moderate',
    retrievedAt: new Date().toISOString(), note: `${name ?? 'Metric'} calculated locally from compatible reported inputs.`,
  };
}

function mergeExtracted(base: ExtractedFinancials, additions: Partial<ExtractedFinancials>): ExtractedFinancials {
  const output = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(additions)) {
    const current = output[key];
    if (current == null || (isMetric(current) && (current.value == null || current.value === '')) || (Array.isArray(current) && !current.length)
      || (isMetric(current) && isMetric(value) && !['verified', 'cross_checked'].includes(current.verificationStatus ?? 'unverified') && ['verified', 'cross_checked'].includes(value.verificationStatus ?? 'unverified'))
      || (isMetric(current) && isMetric(value) && Boolean(current.period?.includes('exact period not parsed')) && !value.period?.includes('exact period not parsed') && Boolean(value.sourceUrl?.includes('screener.in/company/')))) output[key] = value;
  }
  return output as unknown as ExtractedFinancials;
}

function buildSources(evidence: RawEvidence[], supported: Map<string, Set<string>>): ResearchSourceMeta[] {
  return evidence.filter((item) => supported.has(item.url)).map((item) => ({
    id: sourceIdFor(item.url), url: item.url, title: item.title, domain: extractDomain(item.url),
    sourceType: item.sourceType ?? classifySourceType(item.url, item.title), authority: item.authority ?? getDomainAuthority(extractDomain(item.url)),
    publishedAt: item.publishedDate, retrievedAt: new Date().toISOString(),
    snippet: item.content.slice(0, 350), supportedMetrics: [...(supported.get(item.url) ?? [])],
  }));
}

function hasMetric(extracted: ExtractedFinancials, key: MetricKey) { const value = (extracted as unknown as Record<string, unknown>)[key]; return isMetric(value) && value.value != null && value.value !== ''; }
function isMetric(value: unknown): value is FinancialMetric { return Boolean(value && typeof value === 'object' && 'value' in value); }
function metricValue(metric?: FinancialMetric) { if (!metric || metric.value == null) return null; const value = Number(String(metric.value).replace(/,/g, '')); return Number.isFinite(value) ? value : null; }
function compatibleMetrics(a?: FinancialMetric, b?: FinancialMetric) { return Boolean(a && b && metricValue(a) != null && metricValue(b) != null && periodKey(a.period) === periodKey(b.period) && periodKey(a.period) !== '' && (a.basis ?? 'Unspecified') === (b.basis ?? 'Unspecified')); }
function detectBasis(text: string): MetricCandidate['basis'] { const lower = text.toLowerCase(); return lower.includes('consolidated') ? 'Consolidated' : lower.includes('standalone') ? 'Standalone' : 'Unspecified'; }
function periodFromSource(source: RawEvidence) { return source.publishedDate ? `Source published ${source.publishedDate}; exact statement period not parsed` : 'Latest reported period; exact period not parsed'; }
function clarifyPeriod(period: string, type: ParsedTable['periodType'] = 'other') {
  if (/^(mar|jun|sep|dec)\s+20\d{2}$/i.test(period)) {
    if (type === 'quarterly') return `Quarter ending ${period}`;
    if (type === 'balance') return `As of ${period}`;
    if (type === 'annual' || /^mar/i.test(period)) return `Financial year ending ${period}`;
    return `Quarter ending ${period}`;
  }
  return period;
}
function parseNumber(value: string | undefined): number | null { if (!value || /^(?:—|-|n\/a)$/i.test(value.trim())) return null; const n = Number(value.replace(/[₹,%()\s]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? (value.includes('(') && n > 0 ? -n : n) : null; }
function toCrore(value: number, scale: string) { const normalized = scale.toLowerCase(); return normalized === 'lakh' ? value / 100 : normalized === 'million' ? value / 10 : normalized === 'billion' ? value * 100 : value; }
function normalizeLabel(value: string) { return value.toLowerCase().replace(/\+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function findRow(rows: Map<string, Array<number | null>>, aliases: string[]) { for (const alias of aliases) { const exact = rows.get(normalizeLabel(alias)); if (exact) return exact; } for (const [label, values] of rows) if (aliases.some((alias) => label.includes(normalizeLabel(alias)))) return values; return null; }
function lastNumericIndex(values: Array<number | null>) { for (let index = values.length - 1; index >= 0; index -= 1) if (values[index] != null) return index; return -1; }
function isRatioKey(key: MetricKey) { return ['currentRatio', 'quickRatio', 'debtToEquity', 'interestCoverage', 'roe', 'roce', 'pe', 'pb', 'evEbitda', 'dividendYield', 'promoterHolding', 'fiiHolding', 'diiHolding', 'publicHolding', 'pledgedHolding'].includes(key); }
function ratioUnit(key: MetricKey) { return ['roe', 'roce', 'dividendYield', 'promoterHolding', 'fiiHolding', 'diiHolding', 'publicHolding', 'pledgedHolding'].includes(key) ? '%' : 'x'; }
function candidateScore(item: MetricCandidate) { return authorityValue(item.source.authority) * 100 + (item.basis === 'Consolidated' ? 10 : 0) + (item.period.includes('exact period not parsed') ? 0 : 15); }
function authorityValue(value?: string) { return value === 'high' ? 3 : value === 'medium' ? 2 : 1; }
function isPlausibleCandidate(candidate: MetricCandidate) {
  if (!Number.isFinite(candidate.value)) return false;
  const statementKeys: MetricKey[] = ['revenue', 'ebitda', 'netProfit', 'eps', 'totalDebt', 'cash', 'totalAssets', 'totalLiabilities', 'currentAssets', 'currentLiabilities', 'shareholdersEquity', 'equityCapital', 'reserves', 'operatingCashFlow', 'investingCashFlow', 'financingCashFlow', 'capex', 'freeCashFlow', 'interestExpense', 'ebit'];
  if (statementKeys.includes(candidate.key) && candidate.source.authority !== 'high' && !['financial_database', 'annual_report', 'exchange_filing', 'investor_presentation'].includes(candidate.source.sourceType ?? 'other')) return false;
  if (['promoterHolding', 'fiiHolding', 'diiHolding', 'publicHolding', 'pledgedHolding', 'dividendYield'].includes(candidate.key)) return candidate.value >= 0 && candidate.value <= 100;
  if (['roe', 'roce'].includes(candidate.key)) return candidate.value >= -100 && candidate.value <= 200;
  if (['debtToEquity', 'currentRatio', 'quickRatio'].includes(candidate.key)) return candidate.value >= 0 && candidate.value <= 20;
  if (candidate.key === 'interestCoverage') return candidate.value >= -1000 && candidate.value <= 5000;
  return Math.abs(candidate.value) < 1_000_000_000;
}
function compatible(a: MetricCandidate, b: MetricCandidate) { return a.unit === b.unit && a.basis === b.basis && (a.period === b.period || a.period.includes('exact period not parsed') || b.period.includes('exact period not parsed')); }
function candidateCompatibleWithMetric(candidate: MetricCandidate, metric: FinancialMetric) { return candidate.unit === metric.unit && candidate.basis === (metric.basis ?? 'Unspecified') && (periodKey(candidate.period) === periodKey(metric.period) || candidate.period.includes('exact period not parsed') || metric.period?.includes('exact period not parsed')); }
function periodKey(period?: string | null) { if (!period) return ''; const match = period.match(/(mar|jun|sep|dec)\s+(20\d{2})/i); return match ? `${match[1].toLowerCase()}-${match[2]}` : /ttm/i.test(period) ? 'ttm' : period.toLowerCase().trim(); }
function relativeDifference(a: number, b: number) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1); }
function sourceIdFor(url: string) { let hash = 0; for (let i = 0; i < url.length; i += 1) hash = (hash * 31 + url.charCodeAt(i)) >>> 0; return `fin_${hash.toString(36)}`; }
function addSupported(map: Map<string, Set<string>>, url: string, key: string) { if (!map.has(url)) map.set(url, new Set()); map.get(url)!.add(humanMetric(key as MetricKey)); }
function humanMetric(key: MetricKey | string) { const spaced = key.replace(/([A-Z])/g, ' $1').trim(); return spaced.replace(/^./, (char) => char.toUpperCase()); }
function isValidSourceUrl(value: string) { try { const url = new URL(value); return url.protocol === 'https:' && !['scribd.com', 'slideshare.net', 'facebook.com', 'youtube.com', 'tavily.com'].some((domain) => url.hostname.endsWith(domain)); } catch { return false; } }
function isRelevantToCompany(title: string, content: string, company: CompanyIdentity, sourceUrl = '') {
  const archiveTicker = sourceUrl.toUpperCase().match(/AR_\d+_([A-Z0-9&-]+)_/)?.[1];
  if (archiveTicker && archiveTicker !== company.ticker.toUpperCase()) return false;
  const screenerTicker = sourceUrl.toUpperCase().match(/SCREENER\.IN\/COMPANY\/([^/?#]+)/)?.[1];
  if (screenerTicker && screenerTicker !== company.ticker.toUpperCase() && screenerTicker !== (company.screenerSlug ?? company.ticker).toUpperCase()) return false;
  const text = `${title} ${content}`.toLowerCase();
  const ticker = escapeRegex(company.ticker.toLowerCase());
  const words = company.name.toLowerCase().replace(/\b(limited|ltd|company|bank)\b/g, ' ').split(/\s+/).filter((word) => word.length > 2);
  const phrase = words.slice(0, Math.min(2, words.length)).join(' ');
  return new RegExp(`\\b${ticker}\\b`, 'i').test(text) || (phrase.length >= 4 && text.includes(phrase));
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Financial retrieval timed out after ${ms}ms`)), ms))]); }
