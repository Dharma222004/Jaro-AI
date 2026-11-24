import { analyzeWithGroq } from '@/lib/groq/client';
import type {
  ConversationContext,
  QueryClassification,
  ResearchIntent,
  ScreeningFilters,
} from '@/types/conversation';

const INTENTS: ResearchIntent[] = [
  'company_research',
  'fundamental_analysis',
  'technical_analysis',
  'financial_statement_analysis',
  'results_analysis',
  'stock_comparison',
  'sector_analysis',
  'stock_discovery',
  'stock_screening',
  'market_analysis',
  'news_announcements',
  'management_promoter_analysis',
  'risk_assessment',
  'financial_education',
  'investment_decision',
  'sector_ranking',
  'mutual_fund_research',
  'investment_planning',
  'portfolio_analysis',
  'project_context',
  'follow_up',
];

const SYSTEM_PROMPT = `You classify Indian equity-market research questions for Jaro AI.
Return JSON only. Choose exactly one intent from:
${INTENTS.join(', ')}.

Rules:
- company_research: broad or complete analysis of one company.
- fundamental_analysis: ratios, valuation, profitability or balance-sheet quality for named companies.
- technical_analysis: price trend, RSI, moving averages, support/resistance or momentum.
- financial_statement_analysis: cash flow, debt, P&L or balance sheet detail.
- results_analysis: quarterly/annual results, earnings call or investor presentation.
- stock_comparison: two or more named companies, including contextual comparisons.
- sector_analysis: named industry/sector research.
- stock_discovery: thematic company discovery without explicit numeric filters.
- stock_screening: filters such as high ROE, low debt, growth, cash flow, market cap, 52-week low or ownership.
- market_analysis: market/index/macro moves and why the market is rising/falling.
- news_announcements: current news, exchange filings or corporate announcements.
- management_promoter_analysis: governance, management, promoter holding or pledging.
- risk_assessment: risks for a company, sector or market.
- financial_education: timeless concepts or how-to-invest education.
- investment_decision: asks whether/when/where to buy, hold, reduce, book profit, exit, target, entry, stop-loss, risk/reward, or a hypothetical entry price for a named/contextual stock.
- sector_ranking: asks which sectors to focus on, sector rankings, or compares sectors as investment themes.
- mutual_fund_research: mutual fund, SIP, AMC scheme, index fund, fund comparison, NAV or fund-category research.
- investment_planning: asset allocation, available capital/monthly investment, horizon, risk tolerance, or “where should I invest?” planning.
- portfolio_analysis: analyses user-provided holdings, allocations, concentration, gains/losses or fund overlap.
- project_context: asks about an explicitly named ongoing software/product project, its architecture, completed work, bugs or pending tasks.
- follow_up: relies on prior context/pronouns and does not itself clearly fit comparison or another specific intent.

Extract company names/tickers exactly as the user means them. Resolve pronouns from the supplied context. Do not invent companies.
For screening, extract only explicitly requested filters. Percent fields are percentage points. debtToEquity is a ratio. Indian small-cap usually means marketCapMaxCr=20000; mid-cap 20000..50000; large-cap minimum 50000 unless the user gives values.

Schema:
{
  "intent": "one intent",
  "confidence": 0.0,
  "companies": ["company or ticker"],
  "sector": null,
  "isFollowUp": false,
  "requiresFreshData": true,
  "screeningFilters": {
    "marketCapMinCr": null,
    "marketCapMaxCr": null,
    "minRevenueGrowthPct": null,
    "minEarningsGrowthPct": null,
    "minRoePct": null,
    "minRocePct": null,
    "maxDebtToEquity": null,
    "minOperatingCashFlowCr": null,
    "minFreeCashFlowCr": null,
    "maxDistanceFrom52WeekLowPct": null,
    "minInstitutionalHoldingPct": null,
    "sector": null,
    "limit": null
  },
  "rationale": "short reason"
}`;

export async function classifyResearchQuery(
  query: string,
  context?: ConversationContext,
): Promise<QueryClassification> {
  if (isProjectContextQuery(query)) return fallbackClassification(query, context);
  const contextSummary = {
    activeCompanies: context?.activeCompanies?.map((c) => ({ name: c.name, ticker: c.ticker })) ?? [],
    activeSector: context?.activeSector ?? null,
    lastIntent: context?.lastIntent ?? null,
    lastComparisonTickers: context?.lastComparisonTickers ?? [],
  };

  try {
    const result = await analyzeWithGroq({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Conversation context:\n${JSON.stringify(contextSummary)}\n\nUser question:\n${query}`,
      timeoutMs: 15_000,
    });
    const intent = INTENTS.includes(result.intent as ResearchIntent)
      ? (result.intent as ResearchIntent)
      : fallbackIntent(query, context);

    const filters = sanitizeFilters(result.screeningFilters);
    const contextualCompanies = Array.isArray(result.companies)
      ? result.companies.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 4)
      : [];

    // Post-Groq safety net: if LLM returned no companies but query mentions a recognizable brand,
    // use the deterministic fallback to populate companies (handles new IPOs like Swiggy, JPL, etc.)
    const finalCompanies = contextualCompanies.length > 0
      ? contextualCompanies
      : extractFallbackCompanies(query, context);

    return {
      intent,
      confidence: clampNumber(result.confidence, 0, 1, 0.75),
      companies: finalCompanies,
      sector: typeof result.sector === 'string' ? result.sector : null,
      isFollowUp: Boolean(result.isFollowUp),
      requiresFreshData: result.requiresFreshData !== false && intent !== 'financial_education',
      screeningFilters: filters,
      rationale: typeof result.rationale === 'string' ? result.rationale : undefined,
    };
  } catch (error) {
    console.warn('[query-classifier] Groq classification failed; using deterministic fallback:', error);
    return fallbackClassification(query, context);
  }
}

export function isProjectContextQuery(query: string) {
  const value = query.toLowerCase();
  return /\b(jaro ai|this project|the project)\b/.test(value)
    && /\b(pending|progress|architecture|module|implementation|bug|deploy|development|completed|next steps?)\b/.test(value);
}

function fallbackIntent(query: string, context?: ConversationContext): ResearchIntent {
  const q = query.toLowerCase();
  if (isInvestmentDecisionQuery(query, context)) return 'investment_decision';
  if (/\b(mutual fund|index fund|flexi.?cap fund|sip|lump.?sum|expense ratio|amfi|fund manager)\b/.test(q)) return 'mutual_fund_research';
  if (/\b(my portfolio|my holdings|portfolio allocation|sector concentration|fund overlap|unrealised|unrealized)\b/.test(q)) return 'portfolio_analysis';
  if (isProjectContextQuery(query)) return 'project_context';
  if (/\b(where should i invest|where to invest|where can i invest|how should i invest|how do i invest|how to invest|how can i invest|can i invest|want to invest|have .* to invest|have .* rupees|have .* rs|allocate|asset allocation|i can invest|monthly investment|build a diversified portfolio|investing for beginners|investment advice|investment suggestion|start investing)\b/.test(q)) return 'investment_planning';
  if (/\b(which sectors?|sector ranking|compare .* sectors?|next five years)\b/.test(q)) return 'sector_ranking';
  if (/\b(compare|versus|vs\.?|which (?:one |company )?is better)\b/.test(q)) return 'stock_comparison';
  if (/\b(screen|find|identify|companies with|stocks with|high roce|high roe|low debt|cash flow|52.?week low|institutional holding)\b/.test(q)) return 'stock_screening';
  if (/\b(quarter|quarterly|annual result|earnings|concall|investor presentation)\b/.test(q)) return 'results_analysis';
  if (/\b(rsi|macd|moving average|technical|support|resistance|momentum|backtest)\b/.test(q)) return 'technical_analysis';
  if (/\b(promoter|management|governance|pledge|related.party)\b/.test(q)) return 'management_promoter_analysis';
  if (/\b(risk|threat|downside|concern)\b/.test(q)) return 'risk_assessment';
  if (/\b(sector|industry)\b/.test(q)) return 'sector_analysis';
  if (/\b(market|nifty|sensex|index|falling today|rising today)\b/.test(q)) return 'market_analysis';
  if (/\b(news|announcement|filing|latest development)\b/.test(q)) return 'news_announcements';
  if (/\b(revenue|profit|debt|balance sheet|cash flow|financial statement)\b/.test(q)) return 'financial_statement_analysis';
  if (/\b(pe|p\/e|pb|p\/b|roe|roce|valuation|fundamental)\b/.test(q)) return 'fundamental_analysis';
  if (/\b(what is|difference between|explain roe|how to|what should i analyse|learn|how do i|how does|why is|why are|meaning of|definition of|can you explain|tell me about|guide|basics|beginner|personal finance|budget|save money|emergency fund|tax saving|taxation)\b/.test(q)) return 'financial_education';
  if (context?.activeCompanies?.length && /\b(it|its|they|their|that company|what about|how about)\b/.test(q)) return 'follow_up';

  // If a company is explicitly named in the query, classify as company_research
  const extracted = extractFallbackCompanies(query);
  if (extracted.length > 0) return 'company_research';

  // If user has active companies in context and asks a short query
  if (context?.activeCompanies?.length && (q.length < 40 || /\b(buy|sell|target|stop|entry|price|hold|view|report|analysis)\b/.test(q))) {
    return 'follow_up';
  }

  // Otherwise, treat as personal finance & general educational chatbot query!
  return 'financial_education';
}

function fallbackClassification(query: string, context?: ConversationContext): QueryClassification {
  const intent = fallbackIntent(query, context);
  const q = query.toLowerCase();
  const filters: ScreeningFilters = {};
  if (/small.?cap/.test(q)) filters.marketCapMaxCr = 20_000;
  if (/mid.?cap/.test(q)) {
    filters.marketCapMinCr = 20_000;
    filters.marketCapMaxCr = 50_000;
  }
  if (/large.?cap/.test(q)) filters.marketCapMinCr = 50_000;
  if (/low debt|debt.?free/.test(q)) filters.maxDebtToEquity = 0.5;
  if (/high roe/.test(q)) filters.minRoePct = 15;
  if (/high roce/.test(q)) filters.minRocePct = 15;
  if (/revenue growth|increasing revenue/.test(q)) filters.minRevenueGrowthPct = 0;
  if (/profit growth|increasing profit|improving profit/.test(q)) filters.minEarningsGrowthPct = 0;
  if (/near 52.?week low/.test(q)) filters.maxDistanceFrom52WeekLowPct = 15;
  if (/strong cash flow|positive cash flow/.test(q)) filters.minOperatingCashFlowCr = 0;

  return {
    intent,
    confidence: 0.55,
    companies: extractFallbackCompanies(query, context),
    sector: context?.activeSector ?? null,
    isFollowUp: intent === 'follow_up' || Boolean(context?.activeCompanies?.length && (!extractFallbackCompanies(query).length || /\b(it|its|they|their|that company|same company|this stock|the stock|which one)\b/i.test(query))),
    requiresFreshData: intent !== 'financial_education',
    screeningFilters: filters,
    rationale: 'Deterministic fallback classification',
  };
}

export function extractFallbackCompanies(query: string, context?: ConversationContext): string[] {
  const lower = ` ${query.toLowerCase().replace(/[^a-z0-9&]/g, ' ')} `;
  const known: Array<[string, string[]]> = [
    ['RELIANCE', ['reliance industries', 'reliance', 'ril']],
    ['TCS', ['tata consultancy services', 'tata consultancy', 'tcs']],
    ['INFY', ['infosys', 'infy', 'infosis']],
    ['HDFCBANK', ['hdfc bank', 'hdfcbank', 'hdfc babk', 'hdfc bak', 'hdfc bnk']],
    ['HDFCLIFE', ['hdfc life', 'hdfclife']],
    ['HDFCAMC', ['hdfc amc', 'hdfcamc']],
    ['ICICIBANK', ['icici bank', 'icicibank', 'icici']],
    ['SBIN', ['state bank of india', 'sbi', 'sbin']],
    ['KOTAKBANK', ['kotak bank', 'kotak mahindra', 'kotakbank', 'kotak']],
    ['AXISBANK', ['axis bank', 'axisbank', 'axis']],
    ['TMPV', ['tata motors passenger vehicles', 'tata motors pv', 'tmpv', 'tata pv']],
    ['TMCV', ['tata motors commercial vehicles', 'tata motors cv', 'tmcv', 'tata cv']],
    ['ITC', ['itc']],
    ['BHARTIARTL', ['bharti airtel', 'airtel', 'bhartiartl']],
    ['WIPRO', ['wipro']],
    ['TECHM', ['tech mahindra', 'techm']],
    ['HCLTECH', ['hcl technologies', 'hcl tech', 'hcltech']],
    ['SWIGGY', ['swiggy', 'swiggy limited', 'swiggy ltd', 'instamart']],
    ['ZOMATO', ['zomato', 'blinkit', 'eternal', 'zomatoo']],
    ['JIOFIN', ['jio financial', 'jio financial services', 'jiofin', 'jfsl']],
    ['JPL', ['jio platforms', 'jio platforms limited', 'jpl', 'jio platform', 'jio platforms ltd']],
    ['TRENT', ['trent', 'zudio', 'westside']],
    ['OLAELEC', ['ola electric', 'ola electric mobility', 'olaelec', 'ola']],
    ['HYUNDAI', ['hyundai motor india', 'hyundai india', 'hyundai']],
    ['PAYTM', ['paytm', 'one97', 'one 97']],
    ['NYKAA', ['nykaa', 'fsn e-commerce', 'fsn ecommerce']],
    ['IREDA', ['ireda', 'indian renewable energy']],
    ['SUZLON', ['suzlon', 'suzlon energy']],
    ['GAIL', ['gail india', 'gail (india)', 'gail']],
    ['LT', ['l&t', 'larsen & toubro', 'larsen and toubro', 'lt', 'larsen']],
    ['HAL', ['hal', 'hindustan aeronautics']],
    ['BEL', ['bel', 'bharat electronics']],
    ['TITAN', ['titan', 'tanishq']],
    ['ASIANPAINT', ['asian paints', 'asian paint', 'asianpaint']],
    ['SUNPHARMA', ['sun pharma', 'sunpharma']],
    ['TATAPOWER', ['tata power', 'tatapower']],
    ['TATASTEEL', ['tata steel', 'tatasteel']],
    ['TATACONSUM', ['tata consumer', 'tataconsum', 'tata tea']],
    ['BAJFINANCE', ['bajaj finance', 'bajfinance']],
    ['BAJAJFINSV', ['bajaj finserv', 'bajajfinsv']],
    ['COALINDIA', ['coal india', 'coalindia', 'cil']],
    ['NTPC', ['ntpc']],
    ['ONGC', ['ongc']],
    ['POWERGRID', ['power grid', 'powergrid', 'pgcil']],
    ['ULTRACEMCO', ['ultratech cement', 'ultratech', 'ultracemco']],
    ['HINDALCO', ['hindalco']],
    ['JSWSTEEL', ['jsw steel', 'jswsteel']],
    ['M&M', ['mahindra & mahindra', 'mahindra and mahindra', 'm&m', 'mahindra']],
    ['ADANIENT', ['adani enterprises', 'adanient']],
    ['ADANIPORTS', ['adani ports', 'adaniports', 'apsez']],
    ['V2RETAIL', ['v2 retail', 'v2 retail limited', 'v2 retail ltd', 'v2retail']],
    ['APOLLOHOSP', ['apollo hospitals', 'apollo hospital', 'apollohosp', 'apollo hospitals enterprise']],
  ];

  const matchesWithPos: Array<{ ticker: string; pos: number }> = [];
  for (const [ticker, aliases] of known) {
    for (const alias of aliases) {
      const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const match = regex.exec(lower);
      if (match) {
        // Check if this match is negated (e.g. "not reliance", "except reliance")
        const preceding = lower.slice(Math.max(0, match.index - 25), match.index);
        const isNegated = /\b(not|except|instead of|rather than|excluding|other than|don't want|dont want)\s*(?:the\s+)?$/i.test(preceding);
        if (!isNegated) {
          matchesWithPos.push({ ticker, pos: match.index });
          break;
        }
      }
    }
  }

  // Sort by appearance order in the user query
  matchesWithPos.sort((a, b) => a.pos - b.pos);
  const positiveTickers = Array.from(new Set(matchesWithPos.map((m) => m.ticker)));
  // Check for dynamic company mention patterns: e.g. "stock that, Swiggy", "invest in Swiggy", "about the V2 retail"
  const dynamicMatch = query.match(/\b(?:stock\s+(?:that|of|named)?\s*[,:]?\s*|invest\s+in(?:\s+the\s+stock)?\s*[,:]?\s*|shares?\s+of\s+|about\s+(?:the\s+)?|explain\s+(?:about\s+)?(?:the\s+)?|(?:target|stop\s*loss|analysis|research|report|outlook)\s+for\s+(?:the\s+)?|not\s+[a-z0-9&]+,\s*)([A-Za-z0-9&]{2,20}(?:\s+[A-Za-z0-9&]{2,20})?)\b/i);
  if (dynamicMatch && dynamicMatch[1]) {
    const candidate = dynamicMatch[1].toUpperCase().trim();
    const commonStopWords = new Set(['THE', 'THIS', 'THAT', 'SOME', 'ANY', 'GOOD', 'BEST', 'TIME', 'WHAT', 'HOW', 'WHEN', 'STOCK', 'SHARE', 'INVEST', 'INDIA']);
    if (!commonStopWords.has(candidate) && !positiveTickers.includes(candidate)) {
      positiveTickers.push(candidate);
    }
  }

  if (positiveTickers.length > 0) return positiveTickers.slice(0, 4);

  // Filter out any active company that is explicitly negated in the user query (e.g. "not hdfc")
  const nonNegatedActive = (context?.activeCompanies ?? []).filter((comp) => {
    const tickerNegated = new RegExp(`\\b(not|except|other than|instead of)\\s+(?:the\\s+)?(?:${comp.ticker}|${comp.name})\\b`, 'i');
    return !tickerNegated.test(query);
  });

  // If no company mentioned directly in query, check if this is an investment decision or follow-up on active company
  const isDecision = isInvestmentDecisionQuery(query, context);
  const referencesContext = isDecision || /\b(it|its|they|their|that company|same (?:company|instrument)|this stock|the stock|strongest technical signal|moving average|rsi|macd|support|debt|profitability|what if i (?:buy|enter)|target\s*[123]|stop.?loss|hold for|buying price|entry price|when to buy)\b/i.test(query);
  if (referencesContext && nonNegatedActive.length) {
    return nonNegatedActive.map((company) => company.ticker).slice(0, 4);
  }
  return [];
}

export function isInvestmentDecisionQuery(query: string, context?: ConversationContext) {
  const q = query.toLowerCase();
  if (/\b(should i buy|buy now|when (?:should )?(?:i )?buy|when to buy|entry (?:price|zone)|buying price|buy zone|target price|targets? and stop|stop.?loss|risk.?reward|wait for (?:a )?pullback|avoid chasing|suitable for (?:swing|intraday|positional|long.?term)|book (?:partial |complete )?profit|should i exit|should i hold|reduce|what if i buy|position siz|invalidation level|breaks? (?:support|resistance)|right time to (?:get in|invest|buy|enter)|good time to (?:get in|invest|buy|enter)|looking to invest|worth investing|should i invest|can i buy)\b/.test(q)) return true;
  const tradePlanTerms = q.match(/\b(entry|trigger|stop(?:[ -]?loss)?|targets?|risk per (?:trade|share)|position siz(?:e|ing)|account equity|max(?:imum)? daily loss)\b/g) ?? [];
  if (new Set(tradePlanTerms.map((term) => term.replace(/[ -]?loss$/, ''))).size >= 2) return true;
  if (/\b(?:analyse|analyze|assess|review)\b.*\b(?:swing trad(?:e|ing)|intraday|positional trad(?:e|ing))\b/.test(q)) return true;
  return Boolean(context?.lastDecision && /\b(long.?term.*swing|swing.*long.?term|first target|selected this stop|this stop|this target|the setup|entry setup)\b/.test(q));
}

export function classifyInvestmentDecisionQuery(query: string, context?: ConversationContext): QueryClassification {
  const extracted = extractFallbackCompanies(query, context);
  const nonNegatedActive = (context?.activeCompanies ?? []).filter((comp) => {
    const tickerNegated = new RegExp(`\\b(not|except|other than|instead of)\\s+(?:the\\s+)?(?:${comp.ticker}|${comp.name})\\b`, 'i');
    return !tickerNegated.test(query);
  });
  const activeFallback = extracted.length === 0 && nonNegatedActive.length
    ? [nonNegatedActive[0].ticker]
    : extracted;
  return {
    intent: 'investment_decision',
    confidence: 0.95,
    companies: activeFallback,
    sector: context?.activeSector ?? null,
    isFollowUp: Boolean(nonNegatedActive.length && (!extractFallbackCompanies(query).length || activeFallback[0] === nonNegatedActive[0]?.ticker)),
    requiresFreshData: true,
    screeningFilters: {},
    rationale: 'Deterministic investment-decision routing: the query requests or follows up on entry, target, stop-loss, risk/reward or invalidation analysis.',
  };
}

function sanitizeFilters(value: unknown): ScreeningFilters {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const out: ScreeningFilters = {};
  const numericKeys: Array<keyof ScreeningFilters> = [
    'marketCapMinCr', 'marketCapMaxCr', 'minRevenueGrowthPct', 'minEarningsGrowthPct',
    'minRoePct', 'minRocePct', 'maxDebtToEquity', 'minOperatingCashFlowCr',
    'minFreeCashFlowCr', 'maxDistanceFrom52WeekLowPct', 'minInstitutionalHoldingPct', 'limit',
  ];
  for (const key of numericKeys) {
    const n = Number(raw[key]);
    if (raw[key] !== null && raw[key] !== undefined && Number.isFinite(n)) {
      (out as Record<string, unknown>)[key] = n;
    }
  }
  if (typeof raw.sector === 'string' && raw.sector.trim()) out.sector = raw.sector.trim();
  return out;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// ═════════════════════════════════════════════════════════════════════
// Domain gating — finance / money / stock market vs everything else
// ═════════════════════════════════════════════════════════════════════

export type DomainClassification = {
  domain: 'finance' | 'non_finance' | 'uncertain';
  confidence: number;
  reason: string;
}

// Finance / money / stock market / investing keywords (Indian equity context)
const FINANCE_KEYWORDS = [
  // Markets & indexes
  'stock', 'stocks', 'share', 'shares', 'equity', 'equities', 'nse', 'bse', 'nifty', 'sensex',
  'intraday', 'delivery', 'f&o', 'futures', 'options', 'call option', 'put option',
  // Investing & planning
  'invest', 'investment', 'investor', 'portfolio', 'mutual fund', 'sip', 'etf', 'index fund',
  'asset allocation', 'diversification', 'compounding', 'wealth', 'net worth',
  'where should i invest', 'how to invest', 'sip calculator', 'future value',
  // Company analysis & fundamentals
  'company', 'ticker', 'revenue', 'profit', 'earnings', 'roe', 'roce', 'pe ratio', 'pb ratio',
  'balance sheet', 'cash flow', 'p&l', 'profit and loss', 'debt to equity', 'market cap',
  'dividend', 'bonus', 'split', 'buyback', 'promoter', 'fii', 'dii', 'quarterly result',
  // Trading & technical
  'buy', 'sell', 'target', 'stop loss', 'stop-loss', 'entry', 'exit', 'position', 'holding',
  'breakout', 'pullback', 'retest', 'support', 'resistance', 'rsi', 'macd', 'moving average',
  'candlestick', 'chart', 'technical', 'fundamental', 'valuation', 'fair value',
  'target price', 'stop loss', 'risk reward', 'risk/reward', 'position sizing',
  // Personal finance (investment context)
  'save', 'saving', 'emergency fund', 'retirement', 'epf', 'ppf', 'nps',
  'tax saving', '80c', 'section 80c', 'capital gains', 'ltcg', 'stcg',
  'broker', 'zerodha', 'upstox', 'groww', 'angel one', 'icici direct',
  'sebi', 'ipo', 'fpo', 'financial advisor',
  // Indian market context
  'rupee', 'inr', 'indian market', 'dalal street', 'crore', 'lakh',
];

// Truly non-financial / non-commercial topics (strict boundary: never block industries, products or company sectors)
const NON_FINANCE_KEYWORDS = [
  // Weather
  'weather forecast', 'will it rain', 'temperature today', 'rain today', 'weather in',
  // Food recipes
  'recipe for', 'how to cook', 'how to bake', 'cake recipe', 'biryani recipe',
  // Creative / Entertainment non-investment
  'tell me a joke', 'write a poem', 'sing a song', 'tell a story', 'funny joke',
  // Clinical medical diagnosis & personal treatment (hospital company & healthcare equity research is 100% financial!)
  'diagnose my', 'my symptoms', 'how to treat my', 'cure for', 'i have fever', 'i have headache',
  // Relationships
  'dating advice', 'relationship advice', 'love advice', 'how to propose',
];

export function classifyDomain(query: string): DomainClassification {
  const q = query.toLowerCase().trim();

  if (!q) {
    return { domain: 'non_finance', confidence: 1, reason: 'Empty query' };
  }

  // Check if query is an inquiry or contains research patterns
  const companyInquiryRegex = /\b(explain|analyse|analyze|tell me about|research|details on|overview of|performance of|about|stock|share|company|ltd|limited|earnings|revenue|profit|growth|quarterly|valuation|pe|pb|target|stop loss|rsi|macd|invest|buy|sell|fundamentals?|technicals?)\b/i;
  const isResearchAction = companyInquiryRegex.test(q);

  const companyMatch = extractFallbackCompanies(q);
  if (companyMatch.length > 0) {
    return { domain: 'finance', confidence: 0.98, reason: `Recognized company: ${companyMatch[0]}` };
  }

  const financeMatches = FINANCE_KEYWORDS.filter((kw) => q.includes(kw.toLowerCase()));
  const nonFinanceMatches = NON_FINANCE_KEYWORDS.filter((kw) => q.includes(kw.toLowerCase()));

  // Strong finance signal, no purely non-finance signal
  if (financeMatches.length > 0 && nonFinanceMatches.length === 0) {
    return {
      domain: 'finance',
      confidence: 0.92,
      reason: `Finance keywords: ${financeMatches.slice(0, 5).join(', ')}`,
    };
  }

  // Non-finance signal with no finance keywords or research action
  if (nonFinanceMatches.length > 0 && financeMatches.length === 0 && !isResearchAction) {
    return {
      domain: 'non_finance',
      confidence: 0.92,
      reason: `Non-finance keywords: ${nonFinanceMatches.slice(0, 5).join(', ')}`,
    };
  }

  // Both present or research action present -> finance takes precedence
  if (isResearchAction || financeMatches.length > 0) {
    return {
      domain: 'finance',
      confidence: 0.85,
      reason: 'Research inquiry / finance context',
    };
  }

  // Default: allow through to entity resolution rather than falsely declining
  return { domain: 'finance', confidence: 0.7, reason: 'Allowed query' };
}

export function isOutOfDomain(query: string): boolean {
  const classification = classifyDomain(query);
  return classification.domain === 'non_finance';
}

export function outOfDomainResponse(query: string): string {
  const trimmed = query.trim();
  const preview = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
  return `I’m Jaro AI, focused on Indian equity research and investing.

I can help with stock analysis, company research, mutual funds, SIP planning, portfolio strategy, and market data. Your question — “${preview}” — falls outside my domain, so I can’t provide a reliable answer for it.

Try asking about a listed company (e.g., “Analyse TCS”), a stock idea (e.g., “Should I buy HDFC Bank?”), or investing basics (e.g., “How does SIP work?”).`;
}

