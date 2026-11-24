import { streamChatWithGroq } from '@/lib/groq/client';
import {
  classifyDomain,
  classifyInvestmentDecisionQuery,
  classifyResearchQuery,
  extractFallbackCompanies,
  isInvestmentDecisionQuery,
  outOfDomainResponse,
} from './query-classifier';
import { collectQuestionEvidence, screenIndianEquities } from './conversational-collector';
import { resolveCompanyFromQuery, runResearchPipeline } from './orchestrator';
import { parseLookbackDate, parseTimeframe, runTechnicalAnalysis } from '@/lib/technical/engine';
import type { CompanyCandidate, CompanyIdentity } from '@/types/company';
import type { ResearchReport, ResearchSourceMeta, FinancialMetric } from '@/types/research';
import type { TechnicalAnalysisResult } from '@/types/technical';
import type { InvestmentDecisionResult, InvestmentHorizon } from '@/types/decision';
import { buildInvestmentDecision } from '@/lib/decision/engine';
import { extractInvestorPosition } from '@/lib/decision/investor-input';
import { backtestTechnicalMethodology } from '@/lib/decision/backtest';
import type { BacktestResult } from '@/types/backtest';
import { formatMemoryContext } from '@/lib/memory/policy';
import { runSystematicStrategyEngine } from '@/lib/strategy/engine';
import { runQtvtEngine } from '@/lib/strategy/qtvt-engine';
import type {
  ConversationArtifact,
  ConversationContext,
  ConversationHistoryMessage,
  MetricCardData,
  QueryClassification,
  ResearchIntent,
} from '@/types/conversation';

type StageStatus = 'running' | 'completed' | 'failed';

export interface ConversationCallbacks {
  onStage?: (stage: string, status: StageStatus, detail?: string) => void;
  onIntent?: (classification: QueryClassification) => void;
  onContext?: (context: ConversationContext) => void;
  onSources?: (sources: ResearchSourceMeta[]) => void;
  onArtifact?: (artifact: ConversationArtifact) => void;
  onDelta: (text: string) => void;
  onSuggestions?: (suggestions: string[]) => void;
}

export async function runConversationalResearch(params: {
  query: string;
  history?: ConversationHistoryMessage[];
  context?: ConversationContext;
  callbacks: ConversationCallbacks;
}): Promise<void> {
  const { query, history = [], callbacks } = params;
  const context = normalizeContext(params.context);
  const timestamp = new Date().toISOString();

  // Friendly chatbot greeting handler
  const cleanGreeting = query.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
  if (/^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening|day)|sup|namaste|whats\s*up|who\s*are\s*you|what\s*can\s*you\s*do|help|start|how\s*are\s*you|how\s*do\s*you\s*do|hi\s*there|hello\s*there)$/i.test(cleanGreeting)) {
    callbacks.onContext?.(context);
    callbacks.onStage?.('understanding', 'completed', 'Greeting recognized');
    callbacks.onDelta(`Hi there! How are you doing today?

I'm **Jaro AI**, your FINANCIAL INTELLIGENCE FOR INVESTOR assistant and personal finance companion. Here is how I can assist you:

- 💬 **Personal Finance & Advice:** Budgeting, emergency funds, tax-saving strategies (80C, LTCG/STCG), SIP vs lumpsum, and general wealth planning.
- 📊 **Deep Equity Research:** Comprehensive fundamental teardowns, revenue breakdown, business models, and profitability analysis for NSE & BSE listed equities.
- 📈 **Technical Breakout & Trade Scenarios:** Multi-timeframe moving averages (20/50/200 DMA), RSI, support & resistance levels, and systematic entry/target/stop setups.
- 🔍 **Stock Screening:** Filter Indian companies by sector, market cap, high ROE/ROCE thresholds, or low debt-to-equity.

Whenever you want to research a specific stock, simply type its name (e.g., *"ITC"*, *"HDFC Bank"*, or *"TCS breakout"*), and I'll switch straight into deep institutional research mode!

What would you like to explore today?`);
    callbacks.onSuggestions?.([
      'Analyse ITC Limited',
      'What is the buying price for HDFC Bank?',
      'How should I start investing with ₹5,000/month?',
      'Explain the difference between NIFTY 50 and SENSEX',
    ]);
    return;
  }

  callbacks.onStage?.('understanding', 'running', 'Understanding intent and conversation references');
  let classification = isInvestmentDecisionQuery(query, context)
    ? classifyInvestmentDecisionQuery(query, context)
    : await classifyResearchQuery(query, context);
  if (/\bSIP\b|\bmutual funds?\b|\bindex funds?\b|\b(?:flexi|multi|small|mid|large)[ -]?cap funds?\b/i.test(query)) {
    classification = { ...classification, intent: 'mutual_fund_research' };
  }
  if (
    classification.companies.length === 0 &&
    /\b(where\s*(?:should|to|can)\s*i\s*invest|how\s*(?:should|to|can|do)\s*i\s*invest|want\s*to\s*invest|have\s+.*(?:rupees?|rs|inr|\d+).*invest|invest\s+(?:my\s+)?money|investing\s+advice|investment\s+advice|how\s*to\s*start\s*investing|invest\s+(?:for\s+)?beginners?|start\s*investing)\b/i.test(query)
  ) {
    classification = { ...classification, intent: 'investment_planning' };
  }
  callbacks.onIntent?.(classification);
  callbacks.onStage?.('understanding', 'completed', intentLabel(classification.intent));

  // Domain gate — only finance / money / stock market queries are answered.
  let domain = classifyDomain(query);
  if (domain.domain === 'non_finance') {
    // Safety check: before rejecting, verify if query resolves to any Indian listed company
    const safetyCheck = await resolveCompanyFromQuery(query);
    if (safetyCheck.resolved && safetyCheck.company) {
      domain = { domain: 'finance', confidence: 0.99, reason: `Resolved company: ${safetyCheck.company.name}` };
      classification = {
        ...classification,
        intent: classification.intent === 'financial_education' ? 'company_research' : classification.intent,
        companies: [safetyCheck.company.ticker],
      };
    } else {
      callbacks.onContext?.(context);
      callbacks.onDelta(outOfDomainResponse(query));
      callbacks.onStage?.('analysis', 'completed', 'Out of domain — declined to answer');
      callbacks.onSuggestions?.([
        'Analyse TCS for a swing trade',
        'Should I buy HDFC Bank?',
        'How does SIP work?',
        'What is ROE and ROCE?',
      ]);
      return;
    }
  }

  if (classification.intent === 'stock_screening' || classification.intent === 'stock_discovery') {
    await handleScreening(query, classification, context, callbacks);
    return;
  }

  if (classification.intent === 'investment_planning') {
    const nextContext: ConversationContext = { ...context, lastIntent: classification.intent };
    callbacks.onContext?.(nextContext);
    callbacks.onStage?.('analysis', 'running', 'Synthesizing investment planning and personal finance guidance');
    await streamGroundedAnswer({
      query,
      history,
      intent: 'investment_planning',
      evidence: `You are Jaro AI, a premier personal finance and investment planning assistant for Indian investors.
Key principles to address:
1. Warmly acknowledge and validate the user's specific query, financial situation, or amount (e.g. ₹500, ₹5,000, student savings, monthly income). Address them naturally (e.g. "Brother", friend, etc.).
2. For small amounts like ₹500: Highlight that in India, ₹500 is completely sufficient to begin investing via Mutual Fund SIPs (Nifty 50 Index funds, Flexi-cap funds allow ₹100-₹500 SIPs), Liquid Funds for short-term liquidity, or digital gold. Emphasize that building the discipline of investing matters far more than the initial amount.
3. Show concrete compounding potential: Demonstrate how a regular contribution (e.g. ₹500/month or similar) grows over 5, 10, and 15 years at a realistic 12% annual return using a clean Markdown table.
4. Explain the sound financial hierarchy: Emergency fund first (3-6 months expenses in savings/liquid funds), adequate term/health insurance, then low-cost index/mutual funds, then direct equities only after building core savings.
5. Provide actionable steps in India: Choosing Direct-Growth plans on SEBI-regulated platforms (Groww, Zerodha Coin, Kuvera, MF Central), KYC requirements (PAN, Aadhaar, bank account).
6. Disclaim clearly and politely that guidance is for financial education and suitability planning under standard personal finance principles, not SEBI-registered individualized stock tipping.`,
      sources: [],
      timestamp,
      callbacks,
      memoryContext: formatMemoryContext(context.retrievedMemories ?? []),
    });
    callbacks.onStage?.('analysis', 'completed', 'Investment guidance complete');
    callbacks.onSuggestions?.(['How do I start a ₹500 SIP on Groww or Zerodha?', 'What is a Nifty 50 Index Fund?', 'How much should I keep in an emergency fund?']);
    return;
  }

  if (classification.intent === 'portfolio_analysis') {
    const nextContext: ConversationContext = { ...context, lastIntent: classification.intent };
    callbacks.onContext?.(nextContext);
    callbacks.onStage?.('analysis', 'running', 'Analyzing portfolio allocation, diversification, and risk');
    await streamGroundedAnswer({
      query,
      history,
      intent: 'portfolio_analysis',
      evidence: `You are Jaro AI, an institutional-grade portfolio intelligence assistant.
1. If the user provided a list of stocks, mutual funds, or amounts: Evaluate their asset allocation, sector concentration risk, large/mid/small cap distribution, and single-stock exposure (ideal cap < 10-15% per stock, < 25-30% per sector).
2. If holdings are missing: Provide a clear, educational overview of how a balanced Indian portfolio is structured (e.g. 60-70% Large Cap / Index, 20-30% Mid Cap, 10% Gold/Debt), key red flags (over-diversification with 30+ stocks vs high concentration with 2 stocks in the same sector), and invite them to share their portfolio holdings for tailored analysis.
3. Include standard risk management principles and SEBI educational disclosure.`,
      sources: [],
      timestamp,
      callbacks,
      memoryContext: formatMemoryContext(context.retrievedMemories ?? []),
    });
    callbacks.onStage?.('analysis', 'completed', 'Portfolio analysis complete');
    callbacks.onSuggestions?.(['Review my holdings: TCS, HDFC Bank, ITC', 'What is the ideal stock-to-mutual fund ratio?', 'How do I detect sector concentration?']);
    return;
  }

  if (classification.intent === 'project_context') {
    const projectMemories = (context.retrievedMemories ?? []).filter((memory) => memory.type === 'project');
    callbacks.onContext?.({ ...context, lastIntent: 'project_context', currentTask: 'project_context' });
    callbacks.onDelta(projectMemories.length
      ? `# Jaro AI Project Context\n\n## Relevant saved decisions and tasks\n\n${projectMemories.map((memory) => `- **${memory.summary}**\n  - Updated: ${new Date(memory.updatedAt).toLocaleString('en-IN')}\n  - Confidence: ${Math.round(memory.confidence * 100)}%`).join('\n')}\n\nThese are user-saved project memories, not inferred implementation status. Update or delete them from the Memory page when they change.`
      : '# Jaro AI Project Context\n\nNo relevant saved project memory was found. Save confirmed architecture decisions or pending tasks from the Memory page, or explicitly ask Jaro AI to remember them.');
    callbacks.onSuggestions?.(['Show saved project memories', 'What project decisions should I update?', 'Open memory settings']);
    return;
  }

  if (classification.intent === 'mutual_fund_research') {
    const nextContext: ConversationContext = { ...context, lastIntent: classification.intent };
    callbacks.onContext?.(nextContext);
    callbacks.onStage?.('analysis', 'running', 'Analyzing mutual fund strategies, SIP compounding, and categories');
    await streamGroundedAnswer({
      query,
      history,
      intent: 'mutual_fund_research',
      evidence: `You are Jaro AI, an expert mutual fund research and advisory intelligence assistant for Indian investors.
1. Directly answer the user's specific mutual fund or SIP question with depth and clarity.
2. If an amount or duration is mentioned (or general SIP query): Provide clear, mathematical compounding tables showing invested capital vs expected future corpus at 10%, 12%, and 14% CAGR across typical milestones (5, 10, 15, 20 years).
3. Compare categories clearly: Nifty 50 Index Funds (low cost, passive), Flexi Cap Funds (active dynamic cap allocation), Large & Mid Cap, and Liquid/Debt funds for emergency funds.
4. Emphasize choosing Direct-Growth plans (0.5% - 1.5% lower expense ratio compared to Regular plans, which compounds to lakhs over decades).
5. Mention taxation basics in India (Equity LTCG 12.5% above ₹1.25 Lakh, STCG 20%).
6. Frame guidance educationally under standard AMFI and SEBI guidelines.`,
      sources: [],
      timestamp,
      callbacks,
      memoryContext: formatMemoryContext(context.retrievedMemories ?? []),
    });
    callbacks.onStage?.('analysis', 'completed', 'Mutual fund analysis complete');
    callbacks.onSuggestions?.(['What is the difference between Direct and Regular plans?', 'Show a 10-year compounding calculation for ₹2,000/month', 'Best index funds for beginners']);
    return;
  }

  const hasExplicitCompany = classification.companies.length > 0;
  const hasContextCompany = context.activeCompanies.length > 0 && (classification.isFollowUp || isInvestmentDecisionQuery(query, context));
  // Additional safety net: if Groq returned no companies but deterministic fallback finds one, treat it as company-driven
  const deterministicFallback = !hasExplicitCompany && !hasContextCompany ? extractFallbackCompanies(query, context) : [];
  const companyDriven = hasExplicitCompany || hasContextCompany || deterministicFallback.length > 0 || (requiresCompany(classification.intent) && (hasExplicitCompany || context.activeCompanies.length > 0));

  // If deterministic fallback found companies but classification.companies is empty, inject them
  if (deterministicFallback.length > 0 && classification.companies.length === 0) {
    classification = { ...classification, companies: deterministicFallback };
  }

  if (companyDriven) {
    await handleCompanyResearch(query, history, classification, context, callbacks, timestamp);
    return;
  }

  if (classification.intent === 'financial_education') {
    const nextContext = { ...context, lastIntent: classification.intent };
    callbacks.onContext?.(nextContext);
    callbacks.onStage?.('analysis', 'running', 'Preparing an educational explanation');
    await streamGroundedAnswer({
      query,
      history,
      intent: classification.intent,
      evidence: 'You are Jaro AI, a friendly, insightful, and expert personal finance and stock market assistant. Provide a structured, empathetic, and comprehensive response tailored to Indian personal finance and investment practices.',
      sources: [],
      timestamp,
      callbacks,
      memoryContext: formatMemoryContext(context.retrievedMemories ?? []),
    });
    callbacks.onStage?.('analysis', 'completed', 'Explanation complete');
    callbacks.onSuggestions?.(suggestionsFor(classification.intent, context));
    return;
  }

  callbacks.onStage?.('retrieval', 'running', 'Retrieving current, source-ranked market evidence');
  const evidence = await collectQuestionEvidence(query, classification.intent, classification.sector);
  callbacks.onSources?.(evidence.sources);
  callbacks.onStage?.('retrieval', 'completed', `${evidence.sources.length} sources retrieved and ranked`);

  const nextContext: ConversationContext = {
    ...context,
    activeSector: classification.sector ?? context.activeSector,
    lastIntent: classification.intent,
  };
  callbacks.onContext?.(nextContext);
  callbacks.onStage?.('analysis', 'running', 'Synthesizing evidence into a cited research answer');
  await streamGroundedAnswer({
    query,
    history,
    intent: classification.intent,
    evidence: evidence.context || 'No reliable current sources were returned. State this limitation clearly.',
    sources: evidence.sources,
    timestamp: evidence.retrievedAt,
    callbacks,
    memoryContext: formatMemoryContext(context.retrievedMemories ?? []),
  });
  callbacks.onStage?.('analysis', 'completed', 'Source-grounded answer complete');
  callbacks.onSuggestions?.(suggestionsFor(classification.intent, nextContext));
}

async function handleScreening(
  query: string,
  classification: QueryClassification,
  context: ConversationContext,
  callbacks: ConversationCallbacks,
) {
  callbacks.onStage?.('screening', 'running', 'Fetching structured market and fundamental data for the screening universe');
  const result = await screenIndianEquities({
    ...classification.screeningFilters,
    sector: classification.screeningFilters?.sector ?? classification.sector ?? undefined,
  });
  const technicalScreen = /\b(technical|bullish|bearish|momentum|rsi|golden cross|death cross|volume breakout|support|moving average|ema|sma)\b/i.test(query);
  if (technicalScreen && result.rows.length) {
    callbacks.onStage?.('technical_screen', 'running', 'Applying exchange candle-based technical filters to fundamental candidates');
    const candidates = result.rows.slice(0, 8);
    const settled = await Promise.allSettled(candidates.map((row) => runTechnicalAnalysis({ query: row.ticker, timeframe: parseTimeframe(query), exchange: 'NSE' })));
    const enriched = candidates.flatMap((row, index) => {
      const item = settled[index];
      if (item.status !== 'fulfilled') return [];
      const technical = item.value;
      const latest = technical.candles.at(-1)?.close ?? null;
      return [{
        ...row,
        technicalTrend: technical.trend,
        rsi14: technical.indicators.rsi14,
        aboveEma200: latest != null && technical.indicators.ema200 != null ? latest > technical.indicators.ema200 : null,
        relativeVolume: technical.indicators.relativeVolume,
        support: technical.indicators.support,
        _signals: technical.signals,
      }];
    });
    const lower = query.toLowerCase();
    result.rows = enriched.filter((row) => {
      if (/rsi\s*(?:below|under|<)\s*30|oversold/.test(lower)) return row.rsi14 != null && row.rsi14 < 30;
      if (/golden cross/.test(lower)) return row._signals.some((signal) => signal.name === 'Golden Cross');
      if (/death cross/.test(lower)) return row._signals.some((signal) => signal.name === 'Death Cross');
      if (/volume breakout/.test(lower)) return row._signals.some((signal) => signal.name.includes('Volume-confirmed'));
      if (/near (?:important )?support/.test(lower)) {
        const price = row.price;
        return row.support != null && price > 0 && Math.abs((price - row.support) / price) <= 0.03;
      }
      if (/bearish/.test(lower)) return row.technicalTrend === 'bearish';
      return row.technicalTrend === 'bullish' && (row.rsi14 ?? 0) >= 50;
    }).map((row) => {
      const clean = { ...row };
      delete (clean as Partial<typeof clean>)._signals;
      return clean;
    });
    result.sources.push({
      id: 'upstox_screen',
      url: 'https://upstox.com/developer/api-documentation/v3/get-historical-candle-data',
      title: 'Upstox Historical Candle Data V3',
      domain: 'upstox.com',
      sourceType: 'financial_database',
      authority: 'high',
      retrievedAt: new Date().toISOString(),
      snippet: 'OHLCV candles used for local technical screening calculations.',
    });
    result.appliedFilters.push(`Exchange ${parseTimeframe(query)} technical confirmation`);
    const succeeded = enriched.length;
    callbacks.onStage?.('technical_screen', 'completed', `${result.rows.length} matches after technical confirmation (${succeeded}/${candidates.length} datasets retrieved)`);
    if (!succeeded) result.limitations.push('Exchange technical candle data could not be retrieved for the shortlisted candidates; no candidate passed the technical stage.');
  }
  callbacks.onSources?.(result.sources);

  const artifact: ConversationArtifact = {
    kind: 'screening',
    title: classification.intent === 'stock_discovery' ? 'Data-backed stock discovery' : 'Structured stock screen',
    rows: result.rows,
    universeSize: result.universeSize,
    matchedCount: result.rows.length,
    appliedFilters: result.appliedFilters,
  };
  callbacks.onArtifact?.(artifact);

  const nextContext: ConversationContext = {
    ...context,
    activeSector: classification.sector ?? context.activeSector,
    lastIntent: classification.intent,
  };
  callbacks.onContext?.(nextContext);
  callbacks.onStage?.('screening', 'completed', `${result.rows.length} matches from ${result.universeSize} successfully retrieved companies`);

  callbacks.onDelta(buildScreeningMarkdown(query, result));
  callbacks.onSuggestions?.([
    'Compare the top two companies in this screen',
    'Add a low debt filter',
    'Explain the risks in using this screen',
  ]);
}

async function handleCompanyResearch(
  query: string,
  history: ConversationHistoryMessage[],
  classification: QueryClassification,
  context: ConversationContext,
  callbacks: ConversationCallbacks,
  timestamp: string,
) {
  callbacks.onStage?.('company_resolution', 'running', 'Resolving company references and NSE/BSE identities');
  if (classification.intent === 'technical_analysis' && /\b(nifty|sensex|india vix)\b/i.test(query)) {
    const instrumentQuery = classification.companies[0] ?? extractIndexName(query);
    try {
      callbacks.onStage?.('company_resolution', 'completed', `Index request: ${instrumentQuery}`);
      const result = await runTechnicalAnalysis({ query: instrumentQuery, timeframe: parseTimeframe(query), exchange: 'NSE', from: parseLookbackDate(query) });
      callbacks.onSources?.([{
        id: 'upstox_technical',
        url: 'https://upstox.com/developer/api-documentation/v3/get-historical-candle-data',
        title: 'Upstox Historical Candle Data V3', domain: 'upstox.com', sourceType: 'financial_database',
        authority: 'high', retrievedAt: result.retrievedAt,
      }]);
      callbacks.onArtifact?.({ kind: 'technical_analysis', title: `${result.instrument.name} technical chart`, result: trimTechnicalResult(result) });
      callbacks.onContext?.({ ...context, lastIntent: 'technical_analysis' });
      callbacks.onDelta(buildTechnicalMarkdown(result));
      callbacks.onSuggestions?.(['Compare this index on the daily and weekly timeframes', 'Explain the strongest signal', 'Which sectors could be influencing this move?']);
    } catch (error) {
      callbacks.onStage?.('technical_data', 'failed', error instanceof Error ? error.message : 'Index data unavailable');
      callbacks.onDelta(`## Technical analysis unavailable\n\n${error instanceof Error ? error.message : 'Exchange index data could not be retrieved.'}`);
    }
    return;
  }
  const requested = [...classification.companies];

  // If no companies were classified, try extracting from query directly
  if (requested.length === 0) {
    const directMatch = query.match(/\b(?:stock\s+(?:that|of|named)?\s*[,:]?\s*|invest\s+in(?:\s+the\s+stock)?\s*[,:]?\s*|shares?\s+of\s+|about\s+|for\s+|not\s+[a-z0-9&]+,\s*)([A-Za-z0-9&]{3,20})\b/i);
    if (directMatch && directMatch[1]) {
      const candidate = directMatch[1].trim();
      const stopWords = new Set(['the', 'this', 'that', 'some', 'any', 'good', 'best', 'time', 'what', 'how', 'when', 'stock', 'share', 'invest', 'india']);
      if (!stopWords.has(candidate.toLowerCase())) {
        requested.push(candidate);
      }
    }
  }

  // Filter out any context companies that are explicitly negated in user query
  const nonNegatedActive = context.activeCompanies.filter((company) => {
    const isNegated = new RegExp(`\\b(not|except|other than|instead of)\\s+(?:the\\s+)?(?:${company.ticker}|${company.name})\\b`, 'i').test(query);
    return !isNegated;
  });

  if (requested.length === 0 && (classification.isFollowUp || classification.intent === 'follow_up' || ((classification.intent === 'investment_decision' || isInvestmentDecisionQuery(query, context)) && requested.length === 0))) {
    for (const company of nonNegatedActive) {
      if (!requested.some((item) => item.toLowerCase() === company.ticker.toLowerCase())) {
        requested.push(company.ticker);
      }
    }
  }
  if (classification.intent === 'stock_comparison' && requested.length < 2) {
    for (const company of nonNegatedActive) {
      if (!requested.some((item) => item.toLowerCase() === company.ticker.toLowerCase())) requested.push(company.ticker);
      if (requested.length >= 2) break;
    }
  }
  if (requested.length === 0 && nonNegatedActive.length > 0) {
    requested.push(nonNegatedActive[0].ticker);
  } else if (requested.length === 0 && requiresCompany(classification.intent)) {
    requested.push(query);
  }

  const resolved: CompanyIdentity[] = [];
  const ambiguous: CompanyCandidate[] = [];
  for (const companyQuery of requested.slice(0, classification.intent === 'stock_comparison' ? 3 : 1)) {
    const existing = context.activeCompanies.find((company) =>
      company.ticker.toLowerCase() === companyQuery.toLowerCase()
      || company.name.toLowerCase() === companyQuery.toLowerCase(),
    );
    if (existing) {
      resolved.push(existing);
      continue;
    }
    const resolution = await resolveCompanyFromQuery(companyQuery);
    if (resolution.resolved) {
      resolved.push(resolution.company);
      if (resolution.interpretation) {
        callbacks.onStage?.('company_resolution', 'running', resolution.interpretation);
      }
    } else {
      ambiguous.push(...resolution.candidates);
    }
  }

  const uniqueCompanies = uniqueByTicker(resolved);
  if (classification.intent === 'stock_comparison' && uniqueCompanies.length < 2) {
    callbacks.onStage?.('company_resolution', 'failed', 'Two unambiguous companies are required');
    callbacks.onDelta(buildResolutionMessage(query, ambiguous, 'I need two clearly identified listed companies for this comparison.'));
    callbacks.onSuggestions?.(['Compare TCS and Infosys', 'Compare HDFC Bank and ICICI Bank']);
    return;
  }
  if (uniqueCompanies.length === 0) {
    callbacks.onStage?.('company_resolution', 'failed', 'No listed company could be identified confidently');
    callbacks.onDelta(buildResolutionMessage(query, ambiguous, 'I could not confidently identify the listed company.'));
    return;
  }
  callbacks.onStage?.('company_resolution', 'completed', uniqueCompanies.map((c) => `${c.name} (${c.ticker})`).join(', '));

  const isDecisionRequest = classification.intent === 'investment_decision'
    || isInvestmentDecisionQuery(query, context);
  if (isDecisionRequest) {
    const targetCompany = uniqueCompanies[0] ?? context.activeCompanies[0];
    if (targetCompany) {
      await handleInvestmentDecision(query, context, targetCompany, callbacks);
      return;
    }
  }

  const isTechnicalRequest = classification.intent === 'technical_analysis'
    || (classification.intent === 'stock_comparison' && /\b(technical|chart|rsi|macd|moving average|momentum|support|resistance|bullish|bearish)\b/i.test(query));
  if (isTechnicalRequest) {
    await handleTechnicalResearch(query, classification, context, uniqueCompanies, callbacks);
    return;
  }

  const reports = { ...(context.reports ?? {}) };
  const researchResults: Array<{ company: CompanyIdentity; report: ResearchReport; researchId: string; sources: ResearchSourceMeta[] }> = [];

  for (const company of uniqueCompanies) {
    const cached = reports[company.ticker];
    if (cached && classification.intent === 'follow_up') {
      researchResults.push({ company, report: cached, researchId: `conversation-${company.ticker}`, sources: reportSourcesToMeta(cached) });
      continue;
    }

    const result = await runResearchPipeline({
      query,
      company,
      onStage: (stage, status, detail) => callbacks.onStage?.(`${company.ticker}_${stage}`, status, detail),
    });
    if (result.status === 'completed' && result.report) {
      reports[company.ticker] = result.report;
      researchResults.push({
        company,
        report: result.report,
        researchId: result.researchId,
        sources: result.sources ?? reportSourcesToMeta(result.report),
      });
    }
  }

  if (researchResults.length === 0) {
    callbacks.onDelta('## Research unavailable\n\nThe company was identified, but its source-backed research pipeline could not be completed. Please retry. No figures have been fabricated.');
    return;
  }

  const allSources = dedupeSources(researchResults.flatMap((item) => item.sources));
  callbacks.onSources?.(allSources);
  const nextContext: ConversationContext = {
    ...context,
    activeCompanies: uniqueByTicker([...uniqueCompanies, ...context.activeCompanies]).slice(0, 4),
    activeSector: classification.sector ?? uniqueCompanies[0]?.sector ?? context.activeSector,
    lastIntent: classification.intent,
    currentTask: classification.intent,
    reports,
    lastComparisonTickers: classification.intent === 'stock_comparison' ? uniqueCompanies.map((c) => c.ticker) : context.lastComparisonTickers,
  };
  callbacks.onContext?.(nextContext);

  if (classification.intent === 'stock_comparison') {
    const artifact = buildComparisonArtifact(researchResults);
    callbacks.onArtifact?.(artifact);
    callbacks.onDelta(buildComparisonMarkdown(researchResults, timestamp));
    callbacks.onSuggestions?.([
      'Which has better profitability?',
      'Compare their debt and cash flow',
      'What are the key risks for each?',
    ]);
    return;
  }

  const primary = researchResults[0];
  const fullOverview = classification.intent === 'company_research'
    && !classification.isFollowUp
    && /\b(analy[sz]e|research|complete|full|overview|report|company)\b/i.test(query);

  if (fullOverview) {
    callbacks.onArtifact?.({
      kind: 'company_report',
      title: `${primary.company.name} research dossier`,
      researchId: primary.researchId,
      report: primary.report,
      metrics: reportMetricCards(primary.report),
    });
    callbacks.onDelta(buildCompleteCompanyMarkdown(primary.report, allSources));
  } else {
    const focusedAnswer = buildFocusedCompanyAnswer(query, primary.report, allSources);
    callbacks.onStage?.('analysis', 'running', 'Answering from the verified company dossier and current market data');
    if (focusedAnswer) callbacks.onDelta(focusedAnswer);
    else await streamGroundedAnswer({
      query,
      history,
      intent: classification.intent,
      evidence: JSON.stringify(compactReportForChat(primary.report)),
      sources: allSources,
      timestamp,
      callbacks,
      companyName: primary.company.name,
      memoryContext: formatMemoryContext(context.retrievedMemories ?? []),
    });
    callbacks.onStage?.('analysis', 'completed', 'Company research answer complete');
  }
  callbacks.onSuggestions?.(suggestionsFor(classification.intent, nextContext));
}

function buildFocusedCompanyAnswer(query: string, report: ResearchReport, sources: ResearchSourceMeta[]) {
  const lower = query.toLowerCase();
  const sourceNumbers = new Map(sources.map((source, index) => [source.id, index + 1]));
  const metric = (value?: FinancialMetric) => {
    if (!value || value.value == null) return 'Not available in the retrieved data';
    const citation = value.sourceId && sourceNumbers.has(value.sourceId) ? ` [${sourceNumbers.get(value.sourceId)}]` : '';
    return `${value.value}${value.unit ? ` ${value.unit}` : ''}${value.period ? ` · ${value.period}` : ''}${value.basis ? ` · ${value.basis}` : ''}${citation}`;
  };
  if (/\b(debt|borrowings?|leverage|cash balance|net debt)\b/.test(lower)) {
    return `# ${report.company.name} — Debt and Balance-Sheet Position\n\n## Main answer\n\n- **Total debt:** ${metric(report.financials.debt)}\n- **Cash and equivalents:** ${metric(report.financials.cash)}\n- **Net debt:** ${metric(report.financials.netDebt)}\n- **Debt / equity:** ${metric(report.financials.debtToEquity)}\n- **Interest coverage:** ${metric(report.financials.interestCoverage)}\n\n## Interpretation\n\n${report.balanceSheetAnalysis ?? 'A complete balance-sheet interpretation is not available in the retrieved evidence.'}\n\n> Values retain their individual period and reporting basis. TTM and point-in-time balance-sheet figures should not be treated as the same reporting period.`;
  }
  if (/\b(cash flow|free cash|operating cash|capex)\b/.test(lower)) {
    return `# ${report.company.name} — Cash-Flow Review\n\n- **Operating cash flow:** ${metric(report.financials.operatingCashFlow ?? report.financials.cashFlow)}\n- **Investing cash flow:** ${metric(report.financials.investingCashFlow)}\n- **Financing cash flow:** ${metric(report.financials.financingCashFlow)}\n- **Capital expenditure:** ${metric(report.financials.capex)}\n- **Free cash flow:** ${metric(report.financials.freeCashFlow)}\n\n${report.cashFlowAnalysis ?? 'Detailed cash-flow interpretation is unavailable.'}`;
  }
  if (/\b(roe|roce|return on equity|return on capital)\b/.test(lower)) {
    return `# ${report.company.name} — Return Ratios\n\n- **ROE:** ${metric(report.profitability.roe)}\n- **ROCE:** ${metric(report.profitability.roce)}\n- **Net margin:** ${metric(report.profitability.netMargin)}\n\nROE and ROCE use different capital bases. Compare them only with the stated period, basis and sector context.`;
  }
  return null;
}

async function handleInvestmentDecision(
  query: string,
  context: ConversationContext,
  company: CompanyIdentity,
  callbacks: ConversationCallbacks,
) {
  callbacks.onStage?.('fundamental_research', 'running', 'Retrieving source-backed company fundamentals, filings, valuation and material risks');
  const reportResult = await runResearchPipeline({
    query,
    company,
    onStage: (stage, status, detail) => callbacks.onStage?.(`decision_${stage}`, status, detail),
  });
  if (reportResult.status !== 'completed' || !reportResult.report) {
    callbacks.onStage?.('fundamental_research', 'failed', reportResult.error ?? 'Fundamental report unavailable');
    callbacks.onDelta('## Decision research unavailable\n\nThe source-backed fundamental report could not be completed, so Jaro AI will not generate entry, target or decision levels from technical data alone.');
    return;
  }
  callbacks.onStage?.('fundamental_research', 'completed', 'Fundamental and risk dossier ready');

  const position = extractInvestorPosition(query);
  const horizon = position.horizon ?? context.investorProfile?.horizon ?? 'positional';
  const [primaryFrame, confirmationFrame] = decisionTimeframes(horizon);
  const requestedFrames = [...new Set([primaryFrame, confirmationFrame, '1d'])];
  callbacks.onStage?.('multi_timeframe', 'running', `Analyzing ${requestedFrames.join(', ')} timeframe candles`);

  const requests = new Map<string, Promise<TechnicalAnalysisResult>>();
  const getTechnical = (timeframe: import('@/types/technical').TechnicalTimeframe) => {
    if (!requests.has(timeframe)) requests.set(timeframe, runTechnicalAnalysis({
      query: company.ticker,
      exchange: company.exchange === 'BSE' ? 'BSE' : 'NSE',
      isin: company.isin,
      timeframe,
      requireFresh: true,
    }));
    return requests.get(timeframe)!;
  };
  let primary: TechnicalAnalysisResult;
  let confirmation: TechnicalAnalysisResult;
  let daily: TechnicalAnalysisResult;
  try {
    [primary, confirmation, daily] = await Promise.all([
      getTechnical(primaryFrame), getTechnical(confirmationFrame), getTechnical('1d'),
    ]);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : 'Technical data unavailable').replace(/[.\s]+$/, '').replace(/upstox/gi, 'exchange').replace(/angel\s*one/gi, 'exchange').replace(/mstock/gi, 'exchange');
    callbacks.onStage?.('multi_timeframe', 'failed', reason);
    callbacks.onDelta(`## Technical Analysis Unavailable\n\nFundamental research completed. Live technical candle data could not be retrieved: ${reason}. Entry, target and stop-loss levels were not generated.`);
    return;
  }
  callbacks.onStage?.('multi_timeframe', 'completed', `${primaryFrame} and ${confirmationFrame} trend context plus rolling daily 52-week data ready`);
  callbacks.onStage?.('market_regime', 'running', 'Analysing NIFTY 50, sector context and INDIA VIX for systematic trade gates');
  const sectorIndex = sectorIndexQuery(company.sector, company.industry);
  const [marketDailyResult, marketWeeklyResult, sectorResult, vixResult] = await Promise.allSettled([
    runTechnicalAnalysis({ query: 'NIFTY 50', exchange: 'NSE', timeframe: '1d', requireFresh: true }),
    runTechnicalAnalysis({ query: 'NIFTY 50', exchange: 'NSE', timeframe: '1w', requireFresh: true }),
    sectorIndex ? runTechnicalAnalysis({ query: sectorIndex, exchange: 'NSE', timeframe: '1d', requireFresh: true }) : Promise.resolve(null),
    runTechnicalAnalysis({ query: 'INDIA VIX', exchange: 'NSE', timeframe: '1d', requireFresh: true }),
  ]);
  if (marketDailyResult.status !== 'fulfilled') {
    const reason = marketDailyResult.reason instanceof Error ? marketDailyResult.reason.message : 'NIFTY 50 market context unavailable';
    callbacks.onStage?.('market_regime', 'failed', reason);
    callbacks.onDelta(`## No systematic trade plan\n\nValidated stock candles were retrieved, but the mandatory NIFTY 50 market-regime gate could not be evaluated: ${reason}. No entry, stop or targets were approved.`);
    return;
  }
  const systematic = runSystematicStrategyEngine({
    report: reportResult.report,
    stockDaily: daily,
    stockWeekly: confirmationFrame === '1w' ? confirmation : await getTechnical('1w'),
    benchmarkDaily: marketDailyResult.value,
    benchmarkWeekly: marketWeeklyResult.status === 'fulfilled' ? marketWeeklyResult.value : undefined,
    sectorDaily: sectorResult.status === 'fulfilled' ? sectorResult.value : null,
    vixDaily: vixResult.status === 'fulfilled' ? vixResult.value : null,
    horizon,
  });
  callbacks.onStage?.('market_regime', 'completed', `Market ${systematic.marketRegime.classification}; sector ${systematic.sectorStrength.classification}; selected ${systematic.selected?.strategyVersion ?? 'no eligible strategy'}`);
  callbacks.onStage?.('decision_analysis', 'running', 'Running QTVT confluence engine (Quality · Trend · Value · Trigger) with deterministic solver');

  const qtvtHorizon: import('@/types/qtvt').QtvtHorizon = horizon === 'positional' ? 'POSITION' : 'SWING';
  const qtvt = runQtvtEngine({
    report: reportResult.report,
    company,
    stockDaily: daily,
    stockWeekly: confirmationFrame === '1w' ? confirmation : await getTechnical('1w').catch(() => null),
    benchmarkDaily: marketDailyResult.value,
    sectorDaily: sectorResult.status === 'fulfilled' ? sectorResult.value : null,
    vixDaily: vixResult.status === 'fulfilled' ? vixResult.value : null,
    horizon: qtvtHorizon,
    accountCapital: context.investorProfile?.availableCapital ?? 10_00_000,
  });

  const sources = dedupeSources([
    ...(reportResult.sources ?? reportSourcesToMeta(reportResult.report)),
    {
      id: 'exchange_decision',
      url: 'https://www.nseindia.com/market-data',
      title: 'Exchange Historical Market Data Feed',
      domain: 'nseindia.com',
      sourceType: 'financial_database',
      authority: 'high',
      retrievedAt: primary.retrievedAt,
      snippet: 'Validated official exchange OHLCV candles used for deterministic multi-timeframe decision calculations.',
    },
  ]);
  const result = buildInvestmentDecision({
    query,
    company,
    report: reportResult.report,
    primary,
    confirmation,
    daily,
    sources,
    previousPosition: context.investorProfile,
    systematic,
    qtvt,
  });
  callbacks.onSources?.(sources);
  callbacks.onArtifact?.({ kind: 'investment_decision', title: `${company.name} decision research`, result });
  callbacks.onContext?.({
    ...context,
    activeCompanies: uniqueByTicker([company, ...context.activeCompanies]).slice(0, 4),
    activeSector: company.sector ?? context.activeSector,
    lastIntent: 'investment_decision',
    selectedTimeframe: primaryFrame,
    currentTask: 'investment_decision',
    reports: { ...(context.reports ?? {}), [company.ticker]: reportResult.report },
    investorProfile: { ...(context.investorProfile ?? { ownsStock: false }), ...result.positionInput },
    lastDecision: result,
  });
  callbacks.onStage?.('decision_analysis', 'completed', `${result.classification}: scenario and risk framework complete`);
  callbacks.onDelta(buildDecisionMarkdown(result, reportResult.report));
  callbacks.onSuggestions?.([
    `What if I consider an entry at ${Math.round(result.systematic?.selected?.entry?.triggerPrice ?? (result.preferredEntry ? midpoint(result.preferredEntry.rangeLow, result.preferredEntry.rangeHigh) : result.currentPrice))}?`,
    'Explain what would invalidate this thesis',
    'Compare the daily and weekly trend',
  ]);
}

async function handleTechnicalResearch(
  query: string,
  classification: QueryClassification,
  context: ConversationContext,
  companies: CompanyIdentity[],
  callbacks: ConversationCallbacks,
) {
  const timeframe = parseTimeframe(query);
  callbacks.onStage?.('upstox_instrument', 'running', 'Validating exchange instrument keys from the official securities directory');
  callbacks.onStage?.('upstox_instrument', 'completed', `${companies.length} company reference${companies.length === 1 ? '' : 's'} ready for instrument resolution`);
  callbacks.onStage?.('technical_data', 'running', `Computing validated ${timeframe} technical indicators`);

  const settled = await Promise.allSettled(companies.map((company) => runTechnicalAnalysis({
    query: company.ticker,
    timeframe,
    exchange: company.exchange === 'BSE' ? 'BSE' : 'NSE',
    isin: company.isin,
    from: /\bbacktest\b/i.test(query) ? yearsAgo(10) : parseLookbackDate(query),
  })));
  const results = settled.filter((item): item is PromiseFulfilledResult<TechnicalAnalysisResult> => item.status === 'fulfilled').map((item) => item.value);
  const failures = settled.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
  if (!results.length) {
    const reason = failures[0]?.reason instanceof Error ? failures[0].reason.message : 'No technical dataset was returned.';
    callbacks.onStage?.('technical_data', 'failed', reason);
    callbacks.onDelta(`## Technical Analysis Unavailable\n\n${reason.replace(/upstox/gi, 'exchange data').replace(/angel\s*one/gi, 'exchange data')}\n\nNo technical indicator values were generated. This may be due to missing credentials, rate limits, or the instrument not being found. Fundamental analysis above is still valid.`);
    return;
  }

  callbacks.onStage?.('technical_data', 'completed', `${results.reduce((sum, result) => sum + result.candles.length, 0)} validated candles retrieved`);
  callbacks.onStage?.('technical_calculation', 'completed', 'EMA, SMA, RSI, MACD, Stochastic, ATR, Bollinger, volume, ADX and price-action calculations completed locally');
  const source: ResearchSourceMeta = {
    id: 'upstox_technical',
    url: 'https://upstox.com/developer/api-documentation/v3/get-historical-candle-data',
    title: 'Upstox Historical Candle Data V3',
    domain: 'upstox.com',
    sourceType: 'financial_database',
    authority: 'high',
    retrievedAt: results[0].retrievedAt,
    snippet: 'Validated OHLCV candles retrieved server-side with an Upstox Analytics Token; indicators calculated locally.',
  };
  callbacks.onSources?.([source]);
  callbacks.onArtifact?.({ kind: 'technical_analysis', title: `${results[0].instrument.name} technical chart`, result: trimTechnicalResult(results[0]) });
  callbacks.onContext?.({
    ...context,
    activeCompanies: uniqueByTicker([...companies, ...context.activeCompanies]).slice(0, 4),
    lastIntent: classification.intent,
    selectedTimeframe: timeframe,
    currentTask: 'technical_analysis',
    lastComparisonTickers: results.length > 1 ? companies.map((company) => company.ticker) : context.lastComparisonTickers,
  });
  if (results.length === 1 && /\bbacktest\b/i.test(query)) {
    const backtest = backtestTechnicalMethodology({ instrument: results[0].instrument, timeframe: results[0].timeframe, candles: results[0].candles });
    callbacks.onDelta(buildBacktestMarkdown(backtest));
  } else {
    callbacks.onDelta(results.length === 1 ? buildTechnicalResponse(query, results[0]) : buildTechnicalComparisonMarkdown(results));
  }
  callbacks.onSuggestions?.([
    `Analyse the same instrument on the ${timeframe === '1d' ? 'weekly' : 'daily'} timeframe`,
    'Explain the strongest technical signal',
    'Combine this with fundamental risks',
  ]);
}

async function streamGroundedAnswer(params: {
  query: string;
  history: ConversationHistoryMessage[];
  intent: ResearchIntent;
  evidence: string;
  sources: ResearchSourceMeta[];
  timestamp: string;
  callbacks: ConversationCallbacks;
  companyName?: string;
  memoryContext?: string;
}) {
  const sourceIndex = params.sources.map((source, index) => `[${index + 1}] ${source.title} — ${source.url}`).join('\n');
  const isConversationalIntent = [
    'financial_education',
    'investment_planning',
    'portfolio_analysis',
    'mutual_fund_research',
  ].includes(params.intent) || (!params.companyName && params.sources.length === 0);

  const conversationalSystemPrompt = `You are Jaro AI, an intelligent, empathetic, and highly knowledgeable conversational AI financial mentor and personal finance companion for Indian investors.
You provide warm, practical, structured, and insightful financial guidance, investment planning, mutual fund intelligence, and education.

CONVERSATIONAL CHATBOT PRINCIPLES:
1. Warm, engaging, and mentor-like tone: Respond naturally, warmly, and respectfully. If the user addresses you conversationally (e.g. "Brother", "Friend", "Hey Jaro"), warmly acknowledge them. Be encouraging, clear, and easy to understand.
2. Directly answer the user's specific scenario: Immediately answer their specific situation, amount, or question. For example, if they mention ₹500, ₹1,000, or a modest savings amount, warmly validate that even ₹500 is a fantastic starting point in India to start investing via Mutual Fund SIPs, explaining that building discipline and compounding early matters far more than starting capital.
3. Practical Indian financial landscape:
   - Micro-investing & SIPs: Highlight that top Nifty 50 Index Funds, Large Cap, and Flexi Cap Mutual Funds allow SIPs starting at ₹100 or ₹500 per month.
   - Direct-Growth advantage: Always recommend Direct-Growth mutual fund plans over Regular plans to save 0.5%–1.5% in distributor commissions each year, which compounds to significant wealth over time.
   - User-friendly platforms: Mention verified SEBI-regulated platforms (e.g., Groww, Zerodha Coin, Indmoney, MF Central) and basic KYC requirements (PAN card, Aadhaar, verified bank account).
   - Prudent financial hierarchy: Advise creating an emergency fund (in savings account or liquid mutual funds) before risking money in equities.
4. Compounding calculations: When discussing amounts, SIPs, or horizons, provide a clean, readable Markdown table showing compounding growth (e.g. showing invested capital vs estimated future value at 12% CAGR across 5, 10, 15, and 20 years).
5. Educational & Compliance: Clarify politely and naturally that this guidance provides financial education and model scenarios based on sound personal finance principles, rather than SEBI-registered individualized stock tipping.
6. Clean formatting: Use clean Markdown with clear headings (##, ###), bullet points, bold highlights, and tables where appropriate.
7. STRICT DATA SOURCE RULE — NEVER mention "Yahoo Finance", "Upstox", "Angel One", "mStock", "Groq", "NVIDIA", "Screener.in", or any internal/third-party data provider name. Refer only to verified market data or official disclosures if ever citing data.
8. Do NOT append clinical "Data note" footers or robotic "Not available in retrieved data" disclaimers. End with an encouraging closing and offer relevant follow-ups.`;

  const researchSystemPrompt = `You are Jaro AI, a source-grounded Indian equity research assistant.
Answer the exact question in polished Markdown using clear headings, concise paragraphs, bullets, and a table when metrics or comparisons are involved.

NON-NEGOTIABLE RULES:
1. Use only the supplied evidence for current facts, company claims, figures, news, and stock lists.
2. Never fabricate a metric. Say “Not available in the retrieved data” when absent.
3. Cite factual current claims inline using the supplied stable source numbers, for example [1] or [2]. Never expose internal source IDs.
4. Never give personalized buy/sell advice. Provide objective research and monitoring points.
5. Say which reporting period a figure belongs to when the evidence provides it.
6. Real-time market quotes reflect active exchange trading hours.
7. Do not repeat the entire previous report for a focused follow-up. Answer the follow-up directly.
8. End with a short “Data note” containing retrieval time ${params.timestamp} and material limitations.
9. If sources conflict, identify the conflict instead of silently choosing a figure.
10. Do not create a separate source list in the answer; Jaro AI renders the numbered Sources & References panel from the supplied index.
11. STRICT DATA SOURCE RULE — NEVER mention "Yahoo Finance", "Upstox", "Angel One", "mStock", "Groq", "NVIDIA", "Screener.in", or any internal/third-party data provider name in your answer text. Never add source attribution footnotes like "*Source: Yahoo Finance*" or "*Source: ...*". Refer to data only as "exchange data", "regulatory filings", "official disclosures", or "verified research sources". This rule is ABSOLUTE — no exceptions.
12. Always directly and thoroughly answer the specific company or security the user asks about in their latest message. If the user asks whether it is the right time to buy or enter, provide an objective, data-grounded institutional evaluation covering valuation multiples, growth, balance sheet resilience, key risks, and current market levels.`;

  const systemPrompt = isConversationalIntent ? conversationalSystemPrompt : researchSystemPrompt;
  const periodGuardrail = !isConversationalIntent
    ? `\n13. Preserve reporting periods exactly as supplied. Never infer a fiscal quarter or financial year from a month unless the evidence explicitly states that fiscal label.`
    : '';
  const memoryRules = params.memoryContext ? `
${isConversationalIntent ? '9' : '14'}. Use MEMORY CONTEXT only when directly relevant. It may contain prior user requests, preferences, or dated facts.
${isConversationalIntent ? '10' : '15'}. A prior research question does not prove ownership, a transaction, or a user decision.
${isConversationalIntent ? '11' : '16'}. Never reuse a stored market price as current data. Preserve source, reporting period, retrieval timestamp, confidence and verification limitations.
${isConversationalIntent ? '12' : '17'}. Explicit new user instructions override procedural or profile memory.` : '';
  const specialistRules = !isConversationalIntent && params.intent === 'sector_ranking'
    ? `\nSECTOR RANKING RULES: Compare sectors using a transparent 100-point analytical score: growth outlook 20, demand 15, economics/profitability 15, competition 10, policy support 10, leading-company health 10, valuation 10, risk 10. Scores are qualitative evidence summaries, not probabilities. Show each component, missing evidence and source citations. Do not call a popular sector investable if valuation or risk evidence is adverse.`
    : !isConversationalIntent && params.intent === 'mutual_fund_research'
      ? `\nMUTUAL FUND RULES: Prioritize AMFI, AMC factsheets, scheme documents and portfolio disclosures. Distinguish direct/regular and growth/IDCW plans. Do not rank schemes when expense, benchmark, period, risk and portfolio evidence are missing. Do not present suitability advice without horizon, objective and risk tolerance. Label return projections hypothetical.`
      : '';

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt + periodGuardrail + memoryRules + specialistRules },
    ...params.history.slice(-8).map((message) => ({ role: message.role, content: message.content.slice(0, 5000) })),
    {
      role: 'user',
      content: isConversationalIntent
        ? `User question: ${params.query}\n\nCORE GUIDANCE PRINCIPLES:\n${params.evidence}${params.memoryContext ? `\n\nMEMORY CONTEXT:\n${params.memoryContext}` : ''}`
        : `Intent: ${params.intent}\n${params.companyName ? `Company: ${params.companyName}\n` : ''}Question: ${params.query}\n\nMEMORY CONTEXT:\n${params.memoryContext || 'No relevant persistent memory retrieved.'}\n\nEVIDENCE:\n${params.evidence.slice(0, 42_000)}\n\nSOURCE INDEX:\n${sourceIndex || 'No external sources required for this educational explanation.'}`,
    },
  ];

  await streamChatWithGroq({
    messages,
    temperature: isConversationalIntent ? 0.35 : 0.15,
    maxTokens: 5000,
    onDelta: params.callbacks.onDelta,
  });
}

function buildCompleteCompanyMarkdown(report: ResearchReport, sources: ResearchSourceMeta[]): string {
  const f = report.financials;
  const p = report.profitability;
  const v = report.valuation;
  const t = report.technicalAnalysis;
  const sourceNumbers = new Map(sources.map((source, index) => [source.id, index + 1]));
  const sourceRefById = (sourceId?: string | null) => sourceId && sourceNumbers.has(sourceId) ? ` [${sourceNumbers.get(sourceId)}]` : '';
  const sourceRef = (metric?: FinancialMetric) => sourceRefById(metric?.sourceId);
  const metric = (item?: FinancialMetric | null) => item?.value == null || item.value === ''
    ? 'Not available in retrieved data'
    : `${item.value}${item.unit ? ` ${item.unit}` : ''}${item.period ? ` (${item.period})` : ''}`;

  const risks = report.risks.length
    ? report.risks.map((risk) => `- **${risk.risk ?? risk.category} (${risk.severity ?? 'medium'})** — ${risk.description}${risk.whyItMatters ? ` Why it matters: ${risk.whyItMatters}` : ''}${sourceRefById(risk.sourceId)}`).join('\n')
    : '- No source-supported risk detail was retrieved.';
  const developments = report.recentDevelopments.length
    ? report.recentDevelopments.map((item) => `- **${item.headline}**${item.date ? ` (${item.date})` : ''}: ${item.whatHappened ?? item.description ?? 'Details not available.'}${sourceRefById(item.sourceId)}`).join('\n')
    : '- No recent development was available in the retrieved evidence.';
  const commentary = report.managementCommentary.length
    ? report.managementCommentary.map((item) => `- **${item.speaker ?? 'Management'}**${item.date ? ` (${item.date})` : ''}: ${item.quote}${sourceRefById(item.sourceId)}`).join('\n')
    : '- Management commentary was not available in the retrieved evidence.';

  return `# ${report.company.name} — Complete Research Overview

**${report.company.exchange}: ${report.company.ticker}** · ${report.company.sector ?? 'Sector not available'} · Generated ${formatDateTime(report.generatedAt)}

## A. Company Overview

${report.company.description}

- **Business model:** ${report.business.businessModel}
- **Products and services:** ${report.business.products.join(', ') || 'Not available in retrieved data'}
- **Business segments:** ${report.business.segments.map((segment) => `${segment.name}${segment.revenueShare ? ` (${segment.revenueShare})` : ''}`).join(', ') || 'Not available in retrieved data'}
- **Geographies:** ${report.business.geographies.join(', ') || 'Not available in retrieved data'}
- **Major competitors / market position:** Not consistently available in the retrieved structured evidence.

## B. Financial Performance

| Metric | Latest value | Evidence basis |
|---|---:|---|
| Revenue | ${metric(f.revenue)}${sourceRef(f.revenue)} | ${f.revenue.basis ?? 'Unspecified'} |
| Revenue growth | ${metric(f.revenueGrowth)}${sourceRef(f.revenueGrowth)} | Reported/calculated where available |
| Operating profit / EBITDA | ${metric(f.ebitda)}${sourceRef(f.ebitda)} | ${f.ebitda.basis ?? 'Unspecified'} |
| Net profit | ${metric(f.profit)}${sourceRef(f.profit)} | ${f.profit.basis ?? 'Unspecified'} |
| EPS | ${metric(f.eps)}${sourceRef(f.eps)} | ${f.eps.basis ?? 'Unspecified'} |
| EBITDA margin | ${metric(p.ebitdaMargin)}${sourceRef(p.ebitdaMargin)} | Latest available period |
| Net margin | ${metric(p.netMargin)}${sourceRef(p.netMargin)} | Latest available period |
| Cash flow | ${metric(f.cashFlow)}${sourceRef(f.cashFlow)} | Missing quarterly cash-flow detail is explicitly marked |

${report.cashFlowAnalysis ? `**Cash-flow assessment:** ${report.cashFlowAnalysis}` : '**Cash-flow assessment:** Not available in retrieved data.'}

### Balance sheet and cash-flow detail

| Metric | Latest retrieved value |
|---|---:|
| Total assets | ${metric(f.totalAssets)}${sourceRef(f.totalAssets)} |
| Total liabilities | ${metric(f.totalLiabilities)}${sourceRef(f.totalLiabilities)} |
| Shareholders' equity | ${metric(f.shareholdersEquity)}${sourceRef(f.shareholdersEquity)} |
| Current assets / liabilities | ${metric(f.currentAssets)} / ${metric(f.currentLiabilities)} |
| Operating cash flow | ${metric(f.operatingCashFlow ?? f.cashFlow)}${sourceRef(f.operatingCashFlow ?? f.cashFlow)} |
| Investing cash flow | ${metric(f.investingCashFlow)}${sourceRef(f.investingCashFlow)} |
| Financing cash flow | ${metric(f.financingCashFlow)}${sourceRef(f.financingCashFlow)} |
| Capital expenditure | ${metric(f.capex)}${sourceRef(f.capex)} |
| Free cash flow | ${metric(f.freeCashFlow)}${sourceRef(f.freeCashFlow)} |

## C. Fundamental Analysis

| Metric | Value |
|---|---:|
| P/E | ${metric(v.pe)}${sourceRef(v.pe)} |
| P/B | ${metric(v.pb)}${sourceRef(v.pb)} |
| ROE | ${metric(p.roe)}${sourceRef(p.roe)} |
| ROCE | ${metric(p.roce)}${sourceRef(p.roce)} |
| Debt-to-equity | ${metric(f.debtToEquity)}${sourceRef(f.debtToEquity)} |
| Total debt | ${metric(f.debt)}${sourceRef(f.debt)} |
| Current ratio | ${metric(f.currentRatio)}${sourceRef(f.currentRatio)} |
| Interest coverage | ${metric(f.interestCoverage)}${sourceRef(f.interestCoverage)} |
| Promoter holding | ${metric(report.shareholding.promoter)}${sourceRef(report.shareholding.promoter)} |
| FII / DII holding | ${metric(report.shareholding.fii)} / ${metric(report.shareholding.dii)} |
| Dividend yield | ${metric(v.dividendYield)}${sourceRef(v.dividendYield)} |

**Balance-sheet assessment:** ${report.balanceSheetAnalysis ?? 'Not available in retrieved data.'}

## D. Technical Analysis

| Indicator | Value |
|---|---:|
| Market price | ${valueOrUnavailable(t?.price, '₹')} |
| 52-week high / low | ${valueOrUnavailable(t?.high52W, '₹')} / ${valueOrUnavailable(t?.low52W, '₹')} |
| 50-day / 200-day moving average | ${valueOrUnavailable(t?.sma50, '₹')} / ${valueOrUnavailable(t?.sma200, '₹')} |
| RSI | ${valueOrUnavailable(t?.rsi)} |
| MACD / signal | ${valueOrUnavailable(t?.macd)} / ${valueOrUnavailable(t?.macdSignal)} |
| Volume / 20-day average | ${valueOrUnavailable(t?.volume)} / ${valueOrUnavailable(t?.averageVolume20d)} |
| Support / resistance (20-day observed range) | ${valueOrUnavailable(t?.support, '₹')} / ${valueOrUnavailable(t?.resistance, '₹')} |
| 20-day price momentum | ${valueOrUnavailable(t?.priceMomentum20dPct)}${t?.priceMomentum20dPct != null ? '%' : ''} |
| Trend | ${t?.trend ?? 'Not available in retrieved data'} |

${t?.observations ?? 'Volume and price-momentum detail was not available in the retrieved evidence.'}

## E. Management & Governance

- **Promoter holding:** ${metric(report.shareholding.promoter)}
- **Promoter pledging:** ${metric(report.shareholding.pledged)}
- **Promoter background, related-party transactions and governance assessment:** Not consistently available in the retrieved evidence; consult the latest annual report and exchange filings.

${commentary}

## F. Latest Developments

${developments}

## G. Risk Analysis

${risks}

## H. Final Research Summary

${report.researchSummary}

### Positive factors
${report.strengths.length ? report.strengths.map((item) => `- ${item}`).join('\n') : '- No explicit strengths were supported by retrieved evidence.'}

### Growth drivers and monitoring points
${report.growthDrivers.length ? report.growthDrivers.map((item) => `- ${item}`).join('\n') : '- No explicit growth drivers were supported by retrieved evidence.'}

> **Data note:** Generated ${formatDateTime(report.generatedAt)} from ${report.sources.length} verified research sources. “Not available” indicates the field was not disclosed in official company filings; it has not been estimated.`;
}

function compactReportForChat(report: ResearchReport) {
  const compactMetric = (metric: FinancialMetric | undefined) => metric ? {
    value: metric.value, unit: metric.unit, period: metric.period, basis: metric.basis,
    verificationStatus: metric.verificationStatus, sourceId: metric.sourceId,
    formula: metric.formula, note: metric.note,
  } : null;
  return {
    company: report.company,
    business: {
      businessModel: report.business.businessModel,
      products: report.business.products.slice(0, 8),
      segments: report.business.segments.slice(0, 8),
      geographies: report.business.geographies,
    },
    financials: {
      revenue: compactMetric(report.financials.revenue), ebitda: compactMetric(report.financials.ebitda),
      profit: compactMetric(report.financials.profit), eps: compactMetric(report.financials.eps),
      revenueGrowth: compactMetric(report.financials.revenueGrowth), profitGrowth: compactMetric(report.financials.profitGrowth),
      debt: compactMetric(report.financials.debt), cash: compactMetric(report.financials.cash), netDebt: compactMetric(report.financials.netDebt),
      debtToEquity: compactMetric(report.financials.debtToEquity), currentRatio: compactMetric(report.financials.currentRatio),
      interestCoverage: compactMetric(report.financials.interestCoverage), totalAssets: compactMetric(report.financials.totalAssets),
      totalLiabilities: compactMetric(report.financials.totalLiabilities), shareholdersEquity: compactMetric(report.financials.shareholdersEquity),
      operatingCashFlow: compactMetric(report.financials.operatingCashFlow ?? report.financials.cashFlow),
      investingCashFlow: compactMetric(report.financials.investingCashFlow), financingCashFlow: compactMetric(report.financials.financingCashFlow),
      capex: compactMetric(report.financials.capex), freeCashFlow: compactMetric(report.financials.freeCashFlow),
      annualTrend: report.financials.annualTrend?.slice(-5), quarterlyTrend: report.financials.quarterlyTrend?.slice(-4),
    },
    profitability: Object.fromEntries(Object.entries(report.profitability).map(([key, value]) => [key, compactMetric(value)])),
    valuation: Object.fromEntries(Object.entries(report.valuation).map(([key, value]) => [key, compactMetric(value)])),
    shareholding: {
      promoter: compactMetric(report.shareholding.promoter), fii: compactMetric(report.shareholding.fii),
      dii: compactMetric(report.shareholding.dii), public: compactMetric(report.shareholding.public),
      pledged: compactMetric(report.shareholding.pledged), history: report.shareholding.history?.slice(-4),
    },
    researchSummary: report.researchSummary,
    balanceSheetAnalysis: report.balanceSheetAnalysis,
    cashFlowAnalysis: report.cashFlowAnalysis,
    strengths: report.strengths.slice(0, 6), growthDrivers: report.growthDrivers.slice(0, 6),
    risks: report.risks.slice(0, 6), developments: report.recentDevelopments.slice(0, 5),
    dataQuality: { confidence: report.dataQuality?.overallConfidence, missingMetrics: report.dataQuality?.missingMetrics, conflicts: report.dataQuality?.conflicts.slice(0, 5) },
    generatedAt: report.generatedAt,
  };
}

function buildComparisonMarkdown(
  results: Array<{ company: CompanyIdentity; report: ResearchReport }>,
  timestamp: string,
): string {
  const names = results.map((item) => item.company.name);
  const rows = comparisonRows(results);
  const header = `| Metric | ${names.join(' | ')} |\n|---|${names.map(() => '---:').join('|')}|`;
  const body = rows.map((row) => `| ${row.metric} | ${results.map((item) => row.values[item.company.ticker] ?? 'N/A').join(' | ')} |`).join('\n');
  const strengths = results.map((item) => `### ${item.company.name}\n${item.report.strengths.slice(0, 3).map((v) => `- ${v}`).join('\n') || '- No source-supported strengths available.'}\n\n**Key risks**\n${item.report.risks.slice(0, 3).map((v) => `- ${v.risk ?? v.category}: ${v.description}`).join('\n') || '- No source-supported risks available.'}`).join('\n\n');
  return `# ${names.join(' vs ')}\n\n## Financial and valuation comparison\n\n${header}\n${body}\n\n## Business quality, strengths and risks\n\n${strengths}\n\n> **Data note:** Company metrics use each dossier's stated reporting period; market multiples may be delayed. Retrieved ${formatDateTime(timestamp)}. N/A means unavailable—not estimated.`;
}

function buildTechnicalMarkdown(result: TechnicalAnalysisResult): string {
  const i = result.indicators;
  const candle = result.candles.at(-1);
  const signals = result.signals.length
    ? result.signals.map((signal) => `- **${signal.name} — ${signal.confirmation}** (${signal.direction}): ${signal.evidence.join(' ')} **Invalidation:** ${signal.invalidation}`).join('\n')
    : '- No multi-indicator signal met the deterministic detection rules.';
  return `# ${result.instrument.name} — Technical Analysis

**Instrument:** ${result.instrument.instrument_key} · **Exchange:** ${result.instrument.exchange} · **Timeframe:** ${result.timeframe} · **Trend:** ${result.trend} (${result.trendStrength})

## Latest validated candle

| Timestamp | Open | High | Low | Close | Volume |
|---|---:|---:|---:|---:|---:|
| ${result.lastCandleAt ?? 'N/A'} | ${num(candle?.open)} | ${num(candle?.high)} | ${num(candle?.low)} | ${num(candle?.close)} | ${num(candle?.volume, 0)} |

## Indicator summary

| Trend | Momentum | Volatility | Volume / strength |
|---|---|---|---|
| EMA20 ${num(i.ema20)} | RSI(14) ${num(i.rsi14)} | ATR(14) ${num(i.atr14)} | Relative volume ${num(i.relativeVolume)}x |
| EMA50 ${num(i.ema50)} | MACD ${num(i.macd)} | ATR ${num(i.atrPct)}% of price | ADX(14) ${num(i.adx14)} |
| EMA200 ${num(i.ema200)} | Signal ${num(i.macdSignal)} | Bollinger ${num(i.bollingerLower)}–${num(i.bollingerUpper)} | +DI / −DI ${num(i.plusDI14)} / ${num(i.minusDI14)} |

## Price action and key levels

- **Support:** ${num(i.support)}
- **Resistance:** ${num(i.resistance)}
- **Swing structure:** ${i.structure.replaceAll('-', ' ')}
- **Session VWAP:** ${i.vwap == null ? 'Not applicable for this timeframe or unavailable' : num(i.vwap)}

## Bullish evidence
${result.bullishFindings.map((finding) => `- ${finding}`).join('\n') || '- No confirmed bullish evidence.'}

## Bearish evidence
${result.bearishFindings.map((finding) => `- ${finding}`).join('\n') || '- No confirmed bearish evidence.'}

## Detected signals
${signals}

> **Data note:** Status: ${result.dataStatus} · Market session: ${result.marketSession} · Last candle: ${result.lastCandleAt ?? 'N/A'} · Retrieved: ${formatDateTime(result.retrievedAt)} · ${result.candles.length} validated candles. Indicators were calculated locally through quantitative rules and were not generated by the LLM.`;
}

function buildDecisionMarkdown(result: InvestmentDecisionResult, report: ResearchReport): string {
  if (result.qtvt) {
    const q = result.qtvt;
    return `# ${result.company.name} — JARO Method v2 (QTVT Confluence Trade Plan)

> **Verdict: ${q.verdict.replaceAll('_', ' ')}**
> Composite Confluence Score: **${q.score}/100** · Data Confidence: **${q.data_confidence} (${q.data_confidence_score}%)** · Profile: **${q.sector_profile}** · Horizon: **${q.horizon}**

## 1. Executive Summary & Verdict Call
- **Verdict:** \`${q.verdict}\` — ${q.verdict_reason}
- **Deterministic Stance:** ${q.verdict === 'ACTIONABLE' ? 'All mandatory gates passed; trade plan active with structural stop.' : q.verdict === 'WAIT_FOR_ENTRY' ? `Price extended (${((q.cmp - q.setup.entry_zone_low) / q.atr).toFixed(2)} ATR above support) or awaiting pullback to alert price ₹${q.setup.alert_price}.` : q.verdict_reason}

## 2. Deterministic Confluence Trade Plan

| Level / Parameter | Deterministic Output | Basis & Explanation |
|---|---:|---|
| **Current Market Price (CMP)** | ₹${q.cmp.toLocaleString('en-IN')} | Real-time exchange session close |
| **Setup Type & State** | **${q.setup.type}** · \`${q.setup.state}\` | Confluence across ${q.setup.confluence_factors.join('; ')} |
| **Entry Zone** | **₹${q.setup.entry_zone_low} – ₹${q.setup.entry_zone_high}** | Confluence support pocket; alert set at ₹${q.setup.alert_price} |
| **Buying Trigger** | Close > ₹${q.setup.trigger} | Daily close above prior session high with volume expansion |
| **Chase Limit ($E_{max}$)** | **₹${q.setup.chase_limit}** | Maximum viable entry price satisfying Net R/R >= ${q.rr.required_min}:1 |
| **Structural Stop-Loss** | **₹${q.stop.price}** | ${q.stop.basis} (${q.stop.distance_atr} ATR / -${q.stop.distance_pct}%) |
| **Target 1 (Book 40%)** | **₹${q.targets[0]?.price ?? '—'}** | ${q.targets[0]?.basis ?? 'Nearest resistance'} · Net R: **${q.targets[0]?.r_net ?? '—'}:1** (+${q.targets[0]?.upside_pct ?? 0}%) |
| **Target 2 (Book 30%)** | **₹${q.targets[1]?.price ?? '—'}** | ${q.targets[1]?.basis ?? 'Fib extension'} · Net R: **${q.targets[1]?.r_net ?? '—'}:1** (+${q.targets[1]?.upside_pct ?? 0}%) |
| **Target 3 (Book 30%)** | **₹${q.targets[2]?.price ?? '—'}** | ${q.targets[2]?.basis ?? 'Trailing runner'} · Net R: **${q.targets[2]?.r_net ?? '—'}:1** (+${q.targets[2]?.upside_pct ?? 0}%) |
| **Net R/R at CMP** | **${q.rr.at_cmp}:1** | Round-trip statutory costs & slippage deducted (Hurdle: >= ${q.rr.required_min}:1) |
| **Net R/R at Zone Mid** | **${q.rr.at_zone_mid}:1** | Net expected reward-to-risk when filled at midpoint of entry zone |
| **Blended Net Expected R** | **${q.rr.blended_net}:1** | Multi-target weighted portfolio payoff |

### Position Sizing & Execution Constraints
- **Risk Budget:** ${q.sizing.risk_budget_pct}% of capital (₹${q.sizing.max_risk_amount.toLocaleString('en-IN')}).
- **Suggested Position:** **${q.sizing.shares} shares** (₹${q.sizing.position_value.toLocaleString('en-IN')} · ${q.sizing.portfolio_pct}% of account).
- **Execution Rules:** ${q.stop.trail_rule}
- **Time Stop:** ${q.stop.time_stop}
${q.sizing.caps_applied.length ? `- **Active Caps:** ${q.sizing.caps_applied.join('; ')}` : ''}

## 3. Confluence Gate Audit (L0 to L8)

| Level | Gate | Status | Metric Observed | Threshold Required | Deterministic Finding |
|---|---|:---:|---|---|---|
${q.gates.map((g) => `| ${g.group} | ${g.name} | **\`${g.status}\`** | ${g.metric} | ${g.threshold} | ${g.reason} |`).join('\n')}

## 4. Valuation & Fair Value Framework
- **Base Fair Value:** ₹${q.vs.fairValue.base} (${q.vs.fairValue.methodology})
- **Margin of Safety:** **${q.vs.fairValue.marginOfSafetyPct >= 0 ? '+' : ''}${q.vs.fairValue.marginOfSafetyPct}%**
- **Scenarios:** Bear ₹${q.vs.fairValue.bear} · Base ₹${q.vs.fairValue.base} · Bull ₹${q.vs.fairValue.bull}

## 5. What Would Change This Call
${q.what_would_change_the_call.map((w) => `- ${w}`).join('\n')}

---
*Policy ID: ${q.meta.policy_id} · Strategy ID: ${q.meta.strategy_id} · Release Status: ${q.meta.release_status} · Feed: ${q.meta.data_versions.feed}*`;
  }

  const preferred = result.preferredEntry;
  const strategy = result.systematic?.selected;
  const entryMid = preferred ? midpoint(preferred.rangeLow, preferred.rangeHigh) : result.currentPrice;
  const complianceLabel = result.complianceLabel.replace(/[.\s]+$/, '');
  const entries = result.entries.map((entry) => `### ${titleCase(entry.type)} entry — ${entry.status.replaceAll('-', ' ')}

- **Range:** ${money(entry.rangeLow)}–${money(entry.rangeHigh)}
- **Risk:** ${entry.riskLevel}
- **Technical basis:** ${entry.technicalJustification.join(' ')}
- **Fundamental basis:** ${entry.fundamentalJustification.join(' ')}
- **Confirmation required:** ${entry.requiredConfirmation.join('; ')}
- **Invalidation:** ${entry.invalidation}`).join('\n\n');
  const targets = result.targets.map((target) => `| ${target.label} | ${target.scenario} | ${money(target.price)} | ${pct(target.upsidePct)} | ${target.riskReward == null ? 'N/A' : `${target.riskReward}:1`} | ${target.timeframe} | ${target.confidence} |`).join('\n');
  const metric = (value: FinancialMetric | undefined) => formatMetric(value);
  return `# ${result.company.name} — Investment Decision Research

> **Compliance:** ${complianceLabel}. This is an evidence-based scenario framework, not a personalized instruction or guaranteed forecast.

## Stock identification

- **Symbol / exchange:** ${result.company.ticker} / ${result.company.exchange}
- **Sector:** ${result.company.sector ?? 'Not available'}
- **Latest available price:** ${money(result.currentPrice)}
- **Market timestamp:** ${result.marketTimestamp}
- **Data status:** ${result.marketDataStatus} · Feed: Real-time Exchange Market Feed
- **Selected horizon:** ${result.horizon}

${strategy ? `## Systematic strategy decision

**${strategy.strategyName} · ${strategy.strategyVersion} · ${strategy.status.replaceAll('_', ' ')}**

| Parameter | Deterministic result |
|---|---:|
| Current / last price | ${money(result.currentPrice)} |
| ${strategy.entry?.zoneLabel ?? 'Entry zone'} | ${strategy.entry ? `${money(strategy.entry.zoneLow)}–${money(strategy.entry.zoneHigh)}` : 'No validated zone'} |
| Entry trigger | ${strategy.entry ? `${money(strategy.entry.triggerPrice)} — ${strategy.entry.triggerCondition}` : 'Unavailable'} |
| Maximum acceptable entry | ${strategy.entry ? money(strategy.entry.maximumEntryPrice) : 'Unavailable'} |
| Stop / invalidation | ${strategy.stop ? money(strategy.stop.price) : 'Unavailable'} |
| Target 1 | ${strategy.targets[0] ? `${money(strategy.targets[0].price)} · gross ${strategy.targets[0].grossRewardRisk}:1 · net ${strategy.targets[0].netRewardRisk}:1` : 'Not supported'} |
| Target 2 | ${strategy.targets[1] ? `${money(strategy.targets[1].price)} · gross ${strategy.targets[1].grossRewardRisk}:1 · net ${strategy.targets[1].netRewardRisk}:1` : 'Not supported'} |
| Target 3 | ${strategy.targets[2] ? `${money(strategy.targets[2].price)} · gross ${strategy.targets[2].grossRewardRisk}:1 · net ${strategy.targets[2].netRewardRisk}:1` : 'Not justified'} |
| Setup expiry | ${strategy.entry?.expiry ?? 'Unavailable'} |

### Top-down context

- **Market regime:** ${strategy.marketRegime.classification} — ${strategy.marketRegime.reasoning.join(' ')}
- **Sector strength:** ${strategy.sectorStrength.classification} — ${strategy.sectorStrength.reasoning.join(' ')}
- **Stock relative strength:** ${strategy.stockStrength.relativeToNiftyPct == null ? 'Unavailable' : `${strategy.stockStrength.relativeToNiftyPct}% versus NIFTY over the configured lookback`}.
- **Liquidity:** ${strategy.stockStrength.liquidity}; average traded value ${strategy.stockStrength.averageTradedValueCr == null ? 'unavailable' : `₹${strategy.stockStrength.averageTradedValueCr.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`}.

### Mandatory gates

${strategy.gates.map((gate) => `- **${gate.label} — ${gate.status.toUpperCase()}${gate.mandatory ? ' · mandatory' : ''}:** ${gate.reason}`).join('\n')}

### Cost and execution assumptions

${strategy.costs ? `Estimated round-trip cost: **${strategy.costs.estimatedRoundTripCost} bps**, including **${strategy.costs.slippageBpsPerSide} bps per side** for slippage. Net reward/risk uses these configured assumptions.` : 'A cost-adjusted plan could not be calculated.'}

Audit input hash: **${strategy.audit.inputsHash}** · ${strategy.audit.candleCount} accepted strategy candles through ${strategy.audit.lastCandleAt ?? 'unavailable'}.

> Strategy scores summarize documented rule components; they are not probabilities of profit.` : '## Systematic strategy decision\n\nNo systematic playbook had sufficient validated inputs. No trade was approved.'}

## Investment decision

### ${result.classificationLabel}

| Research dimension | Score | Data coverage | Interpretation |
|---|---:|---:|---|
| Fundamental condition | ${score(result.fundamentalScore.score)} | ${result.fundamentalScore.coveragePct}% | ${result.fundamentalScore.label} |
| Valuation condition | ${score(result.valuationScore.score)} | ${result.valuationScore.coveragePct}% | ${result.valuationScore.label} |
| Technical condition | ${score(result.technicalScore.score)} | ${result.technicalScore.coveragePct}% | ${result.technicalScore.label} |
| Risk resilience | ${score(result.riskScore.score)} | ${result.riskScore.coveragePct}% | ${result.riskScore.label} |

Scores are explainable research summaries, not calibrated probabilities. Missing factors are excluded rather than assigned invented values.

## Rolling 52-week position

| Current | 52-week low | 52-week high | From high | From low |
|---:|---:|---:|---:|---:|
| ${money(result.week52.current)} | ${money(result.week52.low)} | ${money(result.week52.high)} | ${pct(-result.week52.distanceFromHighPct)} | +${pct(result.week52.distanceFromLowPct)} |

${result.week52.interpretation}

## Entry strategy

${entries}

${preferred ? `**Preferred research scenario:** ${titleCase(preferred.type)} range ${money(preferred.rangeLow)}–${money(preferred.rangeHigh)}, conditional on all stated confirmations.` : '**Preferred scenario:** None—wait for clearer evidence.'}

## Targets, stop-loss and risk/reward

| Target | Scenario | Price | Upside from ${money(entryMid)} | Reward / risk | Timeframe | Confidence |
|---|---|---:|---:|---:|---|---|
${targets}

${result.targets[0]?.riskReward != null && result.targets[0].riskReward < 1.5 ? `> **Risk/reward flag:** Target 1 offers only ${result.targets[0].riskReward}:1 from the scenario entry, below the engine’s preferred 1.5:1 research threshold. Waiting for a better entry can improve the asymmetry.` : ''}

${result.stopLoss ? `### Structural risk level

- **Stop / thesis-invalidation reference:** ${money(result.stopLoss.price)}
- **Risk per share from scenario entry:** ${money(result.stopLoss.riskPerShare)}
- **Downside:** ${pct(result.stopLoss.downsidePct)}
- **Method:** ${result.stopLoss.approach}
- **Why:** ${result.stopLoss.justification.join(' ')}
- **Gap risk:** ${result.stopLoss.gapRiskNote}` : 'A defensible stop-loss could not be calculated from the available structure.'}

${result.positionSizing ? `### Position sizing from supplied inputs

| Capital | Risk limit | Risk budget | Quantity | Capital used | Estimated costs | Planned loss |
|---:|---:|---:|---:|---:|---:|---:|
| ${money(result.positionSizing.capital)} | ${pct(result.positionSizing.riskPct)} | ${money(result.positionSizing.riskAmount)} | ${result.positionSizing.quantity} | ${money(result.positionSizing.capitalRequired)} | ${money(result.positionSizing.estimatedExecutionCosts)} | ${money(result.positionSizing.estimatedMaximumPlannedLoss)} |

${result.positionSizing.constraints.map((constraint) => `- ${constraint}`).join('\n')}

${result.positionSizing.blockedReasons.map((reason) => `- **Sizing blocked:** ${reason}`).join('\n')}

${result.positionSizing.note}` : '*Position sizing was not calculated because account equity/available capital and acceptable risk percentage were not both supplied.*'}

## Technical analysis

| Indicator | ${result.technical.primary.timeframe} value |
|---|---:|
| Trend / strength | ${result.technical.primary.trend} / ${result.technical.primary.trendStrength} |
| RSI(14) | ${num(result.technical.primary.indicators.rsi14)} |
| MACD / signal | ${num(result.technical.primary.indicators.macd)} / ${num(result.technical.primary.indicators.macdSignal)} |
| EMA20 / EMA50 / EMA200 | ${num(result.technical.primary.indicators.ema20)} / ${num(result.technical.primary.indicators.ema50)} / ${num(result.technical.primary.indicators.ema200)} |
| SMA20 / SMA50 / SMA200 | ${num(result.technical.primary.indicators.sma20)} / ${num(result.technical.primary.indicators.sma50)} / ${num(result.technical.primary.indicators.sma200)} |
| ADX / +DI / −DI | ${num(result.technical.primary.indicators.adx14)} / ${num(result.technical.primary.indicators.plusDI14)} / ${num(result.technical.primary.indicators.minusDI14)} |
| Relative volume | ${num(result.technical.primary.indicators.relativeVolume)}x |
| Support / resistance | ${moneyOrNA(result.technical.primary.indicators.support)} / ${moneyOrNA(result.technical.primary.indicators.resistance)} |
| ATR(14) | ${moneyOrNA(result.technical.primary.indicators.atr14)} (${num(result.technical.primary.indicators.atrPct)}%) |

**Higher-timeframe confirmation:** ${result.technical.confirmation ? `${result.technical.confirmation.timeframe} trend is ${result.technical.confirmation.trend} (${result.technical.confirmation.trendStrength})` : 'Unavailable'}.

## Fundamental analysis

| Metric | Latest retrieved value |
|---|---:|
| Revenue / growth | ${metric(report.financials.revenue)} / ${metric(report.financials.revenueGrowth)} |
| Net profit / growth | ${metric(report.financials.profit)} / ${metric(report.financials.profitGrowth)} |
| ROE / ROCE | ${metric(report.profitability.roe)} / ${metric(report.profitability.roce)} |
| Debt / equity | ${metric(report.financials.debtToEquity)} |
| Free / operating cash flow | ${metric(report.financials.freeCashFlow ?? report.financials.cashFlow)} |
| P/E / P/B / EV-EBITDA | ${metric(report.valuation.pe)} / ${metric(report.valuation.pb)} / ${metric(report.valuation.evEbitda)} |
| Promoter / FII / DII | ${metric(report.shareholding.promoter)} / ${metric(report.shareholding.fii)} / ${metric(report.shareholding.dii)} |

**Financial reporting period:** ${result.financialPeriod ?? 'Not consistently available'}. See source panel for filing links and individual metric periods.

## Investment thesis

### Why it may merit research
${result.investmentThesis.positives.map((item) => `- ${item}`).join('\n') || '- No sufficiently supported positive factor was retrieved.'}

### Catalysts
${result.investmentThesis.catalysts.map((item) => `- ${item}`).join('\n') || '- No source-supported catalyst was retrieved.'}

### Major risks
${result.investmentThesis.risks.map((item) => `- ${item}`).join('\n') || '- No sufficiently detailed risk evidence was retrieved.'}

### Thesis invalidation
${result.investmentThesis.invalidationConditions.map((item) => `- ${item}`).join('\n')}

## Bullish / base / bearish scenarios

${result.scenarios.map((scenario) => `### ${scenario.name}\n${scenario.evidence.map((item) => `- ${item}`).join('\n')}\n\n${scenario.outcome}${scenario.invalidation ? ` **Invalidation:** ${scenario.invalidation}` : ''}`).join('\n\n')}

## Exit and monitoring strategy

${result.exitStrategy.map((item) => `- ${item}`).join('\n')}

## Final conclusion

**${result.classificationLabel}.** Use only the stated conditional entry and invalidation framework. A low price, oversold RSI or proximity to a 52-week low is not by itself a reason to buy.

### Limitations
${result.limitations.map((item) => `- ${item}`).join('\n')}

> **Data note:** Analysis generated ${formatDateTime(result.generatedAt)}. Fundamental and qualitative data sourced from audited filings and official company disclosures. Analytical targets represent quantitative model scenarios; market prices can gap beyond stop levels.`;
}

function buildTechnicalResponse(query: string, result: TechnicalAnalysisResult): string {
  const lower = query.toLowerCase();
  const latest = result.candles.at(-1);
  const i = result.indicators;
  const note = `\n\n> **Data note:** Timeframe: ${result.timeframe} candles · Last candle: ${result.lastCandleAt ?? 'N/A'} · Retrieved: ${formatDateTime(result.retrievedAt)} · Status: ${result.dataStatus}. Values are quantitatively calculated.`;
  if (/200.?day|200.?period|ema\s*200|sma\s*200/.test(lower)) {
    const average = /sma/.test(lower) ? i.sma200 : i.ema200;
    const label = /sma/.test(lower) ? 'SMA200' : 'EMA200';
    if (latest?.close == null || average == null) return `## 200-period moving average\n\nThe retrieved dataset does not contain enough validated candles to calculate ${label}.${note}`;
    const above = latest.close > average;
    const distance = ((latest.close / average) - 1) * 100;
    return `## ${result.instrument.name}: ${above ? 'above' : 'below'} its ${label}\n\n- **Latest close:** ${num(latest.close)}\n- **${label}:** ${num(average)}\n- **Distance:** ${distance >= 0 ? '+' : ''}${num(distance)}%\n- **Interpretation:** The price is ${above ? 'above' : 'below'} the long-term average. This is one trend input and should be read with ADX (${num(i.adx14)}), swing structure (${i.structure.replaceAll('-', ' ')}), and momentum—not as a standalone signal.${note}`;
  }
  if (/\brsi\b/.test(lower)) {
    const condition = i.rsi14 == null ? 'unavailable' : i.rsi14 >= 70 ? 'overbought' : i.rsi14 <= 30 ? 'oversold' : 'neutral range';
    return `## ${result.instrument.name} RSI\n\n- **RSI(14):** ${num(i.rsi14)}\n- **Condition:** ${condition}\n- **Timeframe:** ${result.timeframe}\n\nRSI is a momentum condition, not a standalone reversal or entry signal.${note}`;
  }
  if (/\b(support|resistance)\b/.test(lower)) {
    return `## ${result.instrument.name} key observed levels\n\n- **Support:** ${num(i.support)}\n- **Resistance:** ${num(i.resistance)}\n- **Latest close:** ${num(latest?.close)}\n- **Swing structure:** ${i.structure.replaceAll('-', ' ')}\n\nThese levels are derived from recent validated swing points and can change as new candles form.${note}`;
  }
  if (/\bmacd\b/.test(lower)) {
    return `## ${result.instrument.name} MACD\n\n- **MACD:** ${num(i.macd)}\n- **Signal:** ${num(i.macdSignal)}\n- **Histogram:** ${num(i.macdHistogram)}\n- **Recent crossover:** ${result.signals.find((signal) => signal.name.includes('MACD'))?.name ?? 'No qualifying recent crossover'}${note}`;
  }
  if (/\b(bullish|bearish|trend)\b/.test(lower) && !/analysis|analyse|chart/.test(lower)) {
    return `## ${result.instrument.name} trend assessment\n\n**${result.trend.toUpperCase()} · ${result.trendStrength} strength**\n\n### Supporting evidence\n${[...result.bullishFindings, ...result.bearishFindings].map((item) => `- ${item}`).join('\n')}\n\n### Confirmation status\n${result.signals.slice(0, 5).map((signal) => `- **${signal.name}:** ${signal.confirmation}`).join('\n') || '- No recent multi-indicator event met the detection threshold.'}${note}`;
  }
  return buildTechnicalMarkdown(result);
}

function buildTechnicalComparisonMarkdown(results: TechnicalAnalysisResult[]): string {
  const table = results.map((result) => {
    const i = result.indicators;
    const close = result.candles.at(-1)?.close;
    return `| ${result.instrument.name} | ${result.trend} | ${num(close)} | ${num(i.rsi14)} | ${num(i.macdHistogram)} | ${num(i.ema50)} | ${num(i.ema200)} | ${num(i.adx14)} | ${num(i.relativeVolume)}x |`;
  }).join('\n');
  return `# Technical Comparison — ${results.map((result) => result.instrument.trading_symbol).join(' vs ')}

| Instrument | Trend | Close | RSI(14) | MACD histogram | EMA50 | EMA200 | ADX | Relative volume |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${table}

## Signal comparison
${results.map((result) => `### ${result.instrument.name}\n${result.signals.slice(0, 5).map((signal) => `- **${signal.name} (${signal.confirmation})** — ${signal.evidence.join(' ')}`).join('\n') || '- No qualifying multi-indicator signal.'}`).join('\n\n')}

> **Data note:** All instruments use the ${results[0].timeframe} timeframe. Last-candle and retrieval timestamps are retained per instrument. Calculations are deterministic and locally computed.`;
}

function buildBacktestMarkdown(result: BacktestResult): string {
  const row = (label: string, metrics: BacktestResult['overall']) => `| ${label} | ${metrics.trades} | ${metrics.winRatePct == null ? 'N/A' : pct(metrics.winRatePct)} | ${metrics.averageReturnPct == null ? 'N/A' : pct(metrics.averageReturnPct)} | ${metrics.averageLossPct == null ? 'N/A' : pct(metrics.averageLossPct)} | ${metrics.maximumDrawdownPct == null ? 'N/A' : pct(metrics.maximumDrawdownPct)} | ${metrics.profitFactor ?? 'N/A'} |`;
  return `# ${result.instrument.name} — Historical Methodology Backtest

> This is a diagnostic of one fixed historical methodology—not evidence that a strategy will remain profitable and not a recommendation.

## Methodology
${result.methodology.map((item) => `- ${item}`).join('\n')}

## Assumptions

- Initial notional capital: ${money(result.assumptions.initialCapital)}
- Brokerage/charges allowance: ${result.assumptions.brokerageAndChargesBpsPerSide} bps per side
- Slippage: ${result.assumptions.slippageBpsPerSide} bps per side
- Maximum holding period: ${result.assumptions.maximumHoldingBars} bars
- Coverage: ${result.coverage.from} to ${result.coverage.to} (${result.coverage.candles} candles)

## Results

| Sample | Trades | Win rate | Avg return/trade | Avg loss | Max drawdown | Profit factor |
|---|---:|---:|---:|---:|---:|---:|
${row('In-sample (first 60%)', result.inSample)}
${row('Out-of-sample (last 40%)', result.outOfSample)}
${row('Overall', result.overall)}

## Market-regime diagnostics

| Regime | Trades | Win rate | Avg return/trade | Avg loss | Max drawdown | Profit factor |
|---|---:|---:|---:|---:|---:|---:|
${row('Bull', result.regimePerformance.bull)}
${row('Bear', result.regimePerformance.bear)}
${row('Sideways', result.regimePerformance.sideways)}

The entry rule itself requires bullish EMA alignment, so zero bear-regime entries are possible and must not be misrepresented as evidence of bear-market robustness.

## Limitations
${result.warnings.map((warning) => `- ${warning}`).join('\n')}

> Generated ${formatDateTime(result.generatedAt)} using validated ${result.timeframe} exchange candles. Results include the stated cost and slippage assumptions.`;
}

function buildScreeningMarkdown(
  query: string,
  result: Awaited<ReturnType<typeof screenIndianEquities>>,
): string {
  const filters = result.appliedFilters.map((item) => `- ${item}`).join('\n');
  const hasTechnical = result.rows.some((row) => row.technicalTrend != null);
  const table = result.rows.length
    ? hasTechnical
      ? `| Company | Price* | Revenue growth | ROE | D/E | Trend | RSI | Above EMA200 | Rel. volume |\n|---|---:|---:|---:|---:|---|---:|---|---:|\n${result.rows.map((row) => `| ${row.name} (${row.ticker}) | ₹${formatNum(row.price)} | ${formatPct(row.revenueGrowthPct)} | ${formatPct(row.roePct)} | ${formatNum(row.debtToEquity, 2)} | ${row.technicalTrend ?? 'N/A'} | ${formatNum(row.rsi14)} | ${row.aboveEma200 == null ? 'N/A' : row.aboveEma200 ? 'Yes' : 'No'} | ${formatNum(row.relativeVolume, 2)}x |`).join('\n')}`
      : `| Company | Quality score* | Price** | Mkt cap (₹ Cr) | Revenue growth | Earnings growth | ROE | D/E | FCF (₹ Cr) | From 52W low |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${result.rows.map((row) => `| ${row.name} (${row.ticker}) | ${row.qualityScore ?? 'N/A'}/100 | ₹${formatNum(row.price)} | ${formatNum(row.marketCapCr)} | ${formatPct(row.revenueGrowthPct)} | ${formatPct(row.earningsGrowthPct)} | ${formatPct(row.roePct)} | ${formatNum(row.debtToEquity, 2)} | ${formatNum(row.freeCashFlowCr)} | ${formatPct(row.distanceFrom52WeekLowPct)} |`).join('\n')}`
    : 'No company in the successfully retrieved universe matched every available filter.';
  const limitations = result.limitations.length ? `\n\n### Important limitations\n${result.limitations.map((item) => `- ${item}`).join('\n')}` : '';
  return `# Structured Indian Equity Screen\n\n**Question:** ${query}\n\n### Filters applied\n${filters}\n\n${table}\n\n### How to interpret this screen\n- Results are computed from structured official financial and exchange fundamental fields—not generated from model memory.
- The screen covered ${result.universeSize} companies whose data was successfully retrieved from a disclosed ${30}-company universe.
- *Quality score is an explainable ranking of available ROE, growth, leverage and cash-flow fields; missing fields are excluded and it is not a probability.
- A match is a research starting point, not an investment recommendation.
- Verify shortlisted figures against the latest NSE/BSE filing and annual report.${limitations}\n\n> **Data note:** Retrieved ${formatDateTime(result.retrievedAt)}. Official exchange trading values. Missing fields fail their corresponding filter rather than being guessed.`;
}

function buildComparisonArtifact(
  results: Array<{ company: CompanyIdentity; report: ResearchReport }>,
): ConversationArtifact {
  return {
    kind: 'comparison',
    title: results.map((item) => item.company.name).join(' vs '),
    companies: results.map((item) => item.company),
    rows: comparisonRows(results),
    metrics: [],
  };
}

function comparisonRows(results: Array<{ company: CompanyIdentity; report: ResearchReport }>) {
  const specs: Array<[string, (report: ResearchReport) => FinancialMetric | undefined]> = [
    ['Revenue', (r) => r.financials.revenue],
    ['Revenue growth', (r) => r.financials.revenueGrowth],
    ['Net profit', (r) => r.financials.profit],
    ['Net margin', (r) => r.profitability.netMargin],
    ['ROE', (r) => r.profitability.roe],
    ['ROCE', (r) => r.profitability.roce],
    ['Debt / equity', (r) => r.financials.debtToEquity],
    ['P/E', (r) => r.valuation.pe],
    ['P/B', (r) => r.valuation.pb],
    ['Dividend yield', (r) => r.valuation.dividendYield],
  ];
  return specs.map(([metric, getter]) => ({
    metric,
    values: Object.fromEntries(results.map((item) => [item.company.ticker, formatMetric(getter(item.report))])),
  }));
}

function reportMetricCards(report: ResearchReport): MetricCardData[] {
  return [
    { label: 'Market cap', value: formatMetric(report.valuation.marketCap) },
    { label: 'Revenue', value: formatMetric(report.financials.revenue) },
    { label: 'Net profit', value: formatMetric(report.financials.profit) },
    { label: 'ROE', value: formatMetric(report.profitability.roe) },
    { label: 'ROCE', value: formatMetric(report.profitability.roce) },
    { label: 'Debt / equity', value: formatMetric(report.financials.debtToEquity) },
    { label: 'P/E', value: formatMetric(report.valuation.pe) },
    { label: 'Promoter holding', value: formatMetric(report.shareholding.promoter) },
  ];
}

function formatMetric(metric?: FinancialMetric | null): string {
  if (!metric || metric.value == null || metric.value === '') return 'N/A';
  const unit = metric.unit?.trim();
  return `${metric.value}${unit ? ` ${unit}` : ''}${metric.period ? ` · ${metric.period}` : ''}`;
}

function normalizeContext(context?: ConversationContext): ConversationContext {
  return {
    activeCompanies: Array.isArray(context?.activeCompanies) ? context.activeCompanies : [],
    activeSector: context?.activeSector ?? null,
    lastIntent: context?.lastIntent,
    reports: context?.reports ?? {},
    lastComparisonTickers: context?.lastComparisonTickers ?? [],
    investorProfile: context?.investorProfile,
    lastDecision: context?.lastDecision,
    selectedTimeframe: context?.selectedTimeframe ?? null,
    currentTask: context?.currentTask ?? null,
    activeAssumptions: context?.activeAssumptions ?? [],
    pendingClarifications: context?.pendingClarifications ?? [],
    retrievedMemories: context?.retrievedMemories ?? [],
  };
}

function requiresCompany(intent: ResearchIntent): boolean {
  return [
    'company_research', 'fundamental_analysis', 'technical_analysis',
    'financial_statement_analysis', 'results_analysis', 'stock_comparison',
    'management_promoter_analysis', 'investment_decision', 'follow_up',
  ].includes(intent);
}

function intentLabel(intent: ResearchIntent): string {
  return intent.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function suggestionsFor(intent: ResearchIntent, context: ConversationContext): string[] {
  const company = context.activeCompanies[0]?.name;
  if (company) {
    if (intent === 'risk_assessment') return [`How strong is ${company}'s balance sheet?`, `What should I monitor next quarter?`, `Compare it with a peer`];
    return [`What are ${company}'s major risks?`, 'Explain its debt and cash flow', 'Compare it with its closest listed peer'];
  }
  if (intent === 'investment_planning') return ['How do I start a ₹500 SIP on Groww or Zerodha?', 'What is a Nifty 50 Index Fund?', 'How much should I keep in an emergency fund?'];
  if (intent === 'mutual_fund_research') return ['What is the difference between Direct and Regular plans?', 'Show a 10-year compounding calculation for ₹2,000/month', 'Best index funds for beginners'];
  if (intent === 'portfolio_analysis') return ['Review my holdings: TCS, HDFC Bank, ITC', 'What is the ideal stock-to-mutual fund ratio?', 'How do I detect sector concentration?'];
  if (intent === 'financial_education') return ['How do mutual funds work?', 'What is the 50-30-20 budgeting rule?', 'How does compounding work over 10 years?'];
  if (intent === 'market_analysis') return ['Which sectors are holding up best?', 'How are FII and DII flows affecting the market?', 'Find low-debt companies near 52-week lows'];
  if (intent === 'sector_analysis') return ['Which listed companies lead this sector?', 'What are the sector’s main risks?', 'Screen the sector for low debt'];
  return ['Explain ROE vs ROCE', 'Find companies with revenue growth and low debt', 'Why is the Indian market moving today?'];
}

function reportSourcesToMeta(report: ResearchReport): ResearchSourceMeta[] {
  return report.sources.map((source) => ({
    id: source.id,
    url: source.url,
    title: source.title,
    domain: source.domain,
    sourceType: normalizeSourceType(source.sourceType),
    authority: source.authority ?? 'medium',
    publishedAt: source.publishedAt ?? undefined,
    retrievedAt: report.generatedAt,
  }));
}

function normalizeSourceType(value: string): ResearchSourceMeta['sourceType'] {
  const allowed: ResearchSourceMeta['sourceType'][] = ['annual_report', 'exchange_filing', 'investor_presentation', 'financial_database', 'news', 'analysis', 'other'];
  return allowed.includes(value as ResearchSourceMeta['sourceType']) ? value as ResearchSourceMeta['sourceType'] : 'other';
}

function dedupeSources(sources: ResearchSourceMeta[]): ResearchSourceMeta[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }).slice(0, 24);
}

function uniqueByTicker(companies: CompanyIdentity[]): CompanyIdentity[] {
  const seen = new Set<string>();
  return companies.filter((company) => {
    const ticker = company.ticker.toUpperCase();
    if (seen.has(ticker)) return false;
    seen.add(ticker);
    return true;
  });
}

function buildResolutionMessage(query: string, candidates: CompanyCandidate[], prefix: string): string {
  const options = candidates.length
    ? `\n\nDid you mean:\n${candidates.slice(0, 6).map((item) => `- **${item.name}** (${item.exchange}: ${item.ticker})${item.description ? ` — ${item.description}` : ''}`).join('\n')}`
    : '\n\nPlease provide the full company name or NSE/BSE ticker.';
  return `## Company clarification needed\n\n${prefix}\n\nOriginal question: “${query}”${options}`;
}

function formatNum(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals }).format(value);
}

function num(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return value.toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

function formatPct(value: number | null | undefined): string {
  return value == null ? 'N/A' : `${formatNum(value)}%`;
}

function valueOrUnavailable(value: string | number | null | undefined, prefix = ''): string {
  return value == null || value === '' ? 'Not available in retrieved data' : `${prefix}${value}`;
}

function extractIndexName(query: string): string {
  if (/bank\s*nifty/i.test(query)) return 'NIFTY BANK';
  if (/nifty\s*next\s*50/i.test(query)) return 'NIFTY NEXT 50';
  if (/india\s*vix/i.test(query)) return 'INDIA VIX';
  if (/sensex/i.test(query)) return 'SENSEX';
  return 'NIFTY 50';
}

function trimTechnicalResult(result: TechnicalAnalysisResult, limit = 260): TechnicalAnalysisResult {
  if (result.candles.length <= limit) return result;
  const start = result.candles.length - limit;
  return {
    ...result,
    candles: result.candles.slice(start),
    series: Object.fromEntries(
      Object.entries(result.series).map(([key, values]) => [key, values.slice(start)]),
    ) as unknown as TechnicalAnalysisResult['series'],
  };
}

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  } catch {
    return value;
  }
}

function decisionTimeframes(horizon: InvestmentHorizon): [import('@/types/technical').TechnicalTimeframe, import('@/types/technical').TechnicalTimeframe] {
  if (horizon === 'intraday') return ['15m', '1h'];
  if (horizon === 'swing') return ['1h', '1d'];
  if (horizon === 'long-term') return ['1w', '1mo'];
  return ['1d', '1w'];
}

function sectorIndexQuery(sector?: string | null, industry?: string | null) {
  const value = `${sector ?? ''} ${industry ?? ''}`.toLowerCase();
  if (/bank|financial|nbfc/.test(value)) return 'NIFTY BANK';
  if (/information technology|software|it services/.test(value)) return 'NIFTY IT';
  if (/automobile|auto /.test(value)) return 'NIFTY AUTO';
  if (/pharma|healthcare/.test(value)) return 'NIFTY PHARMA';
  if (/fmcg|consumer staples/.test(value)) return 'NIFTY FMCG';
  if (/metal|mining/.test(value)) return 'NIFTY METAL';
  if (/real estate|realty/.test(value)) return 'NIFTY REALTY';
  if (/energy|oil|gas|utilities/.test(value)) return 'NIFTY OIL AND GAS';
  return null;
}

function midpoint(low: number, high: number) {
  return (low + high) / 2;
}

function money(value: number) {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function moneyOrNA(value: number | null | undefined) {
  return value == null ? 'N/A' : money(value);
}

function pct(value: number) {
  return `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

function score(value: number | null) {
  return value == null ? 'N/A' : `${value}/100`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
}

function yearsAgo(years: number) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

function buildPlanningResponse(query: string, context: ConversationContext): { markdown: string; context: ConversationContext } {
  const amount = parseMoney(query, /(?:i have|capital|invest(?:ment)?(?: amount)?|lump.?sum)\s*(?:of|is|=|:)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i);
  const monthly = parseMoney(query, /(?:monthly|per month|each month|sip)\s*(?:investment|amount)?\s*(?:of|is|=|:)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i)
    ?? parseMoney(query, /(?:invest|save)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(?:monthly|per month|each month)/i);
  const years = Number(query.match(/\b(\d{1,2})\s*[- ]?years?\b/i)?.[1] ?? 0) || undefined;
  const riskTolerance = /\b(low risk|conservative|don'?t want excessive risk)\b/i.test(query) ? 'low'
    : /\b(high risk|aggressive)\b/i.test(query) ? 'high'
      : /\b(moderate risk|balanced)\b/i.test(query) ? 'moderate' : context.investorProfile?.riskTolerance;
  const profile = {
    ...(context.investorProfile ?? { ownsStock: false }),
    ...(amount ? { availableCapital: amount } : {}),
    ...(monthly ? { monthlyInvestment: monthly } : {}),
    ...(years ? { objective: `${years}-year investment horizon` } : {}),
    ...(riskTolerance ? { riskTolerance } : {}),
  };
  const missing = [!years && !context.investorProfile?.objective ? 'investment horizon' : '', !riskTolerance ? 'risk tolerance' : '', !amount && !monthly && !context.investorProfile?.availableCapital && !context.investorProfile?.monthlyInvestment ? 'available lump sum or monthly capacity' : '', 'liquidity/emergency-fund needs', 'existing investments'].filter(Boolean);
  const assumptions = [amount ? `Available capital: ${money(amount)}` : null, monthly ? `Monthly capacity: ${money(monthly)}` : null, years ? `Horizon: ${years} years` : null, riskTolerance ? `Risk tolerance stated: ${riskTolerance}` : null].filter(Boolean);
  const markdown = `# Investment Planning Research Intake

> Jaro AI can provide financial education and model allocations with explicit assumptions. It does not provide regulated personalized investment advice or claim to be a SEBI-registered adviser.

## Information understood
${assumptions.length ? assumptions.map((item) => `- ${item}`).join('\n') : '- No usable planning inputs were identified yet.'}

## Information still needed before discussing a model allocation
${missing.map((item) => `- ${item}`).join('\n')}

## Research process

1. Preserve an appropriate emergency/liquidity reserve before market-linked investing.
2. Define goal, horizon and loss tolerance.
3. Choose a broad asset-allocation range rather than starting with individual products.
4. Compare diversified, low-cost options before concentrated sector or small-cap exposure.
5. Review taxes, costs, overlap and rebalancing rules.
6. Research individual stocks only for the portion whose volatility and company-specific risk the investor can tolerate.

## Important distinction

- **Stocks:** concentrated business, valuation and execution risk; require ongoing company monitoring.
- **Diversified mutual/index funds:** broader diversification, but still carry market, category, tracking and manager/process risks.
- **Debt/cash allocation:** can support near-term goals and portfolio stability, but credit, duration, reinvestment and inflation risks still matter.

No allocation percentages have been invented because the required suitability inputs are incomplete.`;
  return { markdown, context: { ...context, lastIntent: 'investment_planning', investorProfile: profile } };
}

function buildPortfolioIntakeResponse(query: string): string {
  const holdings = [...query.matchAll(/\b([A-Z][A-Z0-9&.-]{1,14})\s*[:x-]?\s*(\d+)\s*(?:shares?|qty|units?)\b/g)].map((match) => ({ symbol: match[1], quantity: Number(match[2]) }));
  return `# Portfolio Intelligence Intake

> Portfolio observations require holdings supplied voluntarily by the user. Jaro AI does not access or trade a brokerage account through this feature.

${holdings.length ? `## Parsed holdings\n\n| Symbol | Quantity |\n|---|---:|\n${holdings.map((holding) => `| ${holding.symbol} | ${holding.quantity} |`).join('\n')}\n\nThese symbols still need instrument validation and, for gain/loss analysis, purchase prices.` : `I could not reliably parse a holdings list. Provide entries in a format such as:\n\n- \`TCS 10 shares, average price ₹2,500\`\n- \`HDFCBANK 15 shares, average price ₹1,600\`\n- Mutual fund scheme name, plan, option, units and invested value`}

## Analysis available after validation

- Stock, sector and market-cap concentration.
- Fundamental and technical condition.
- Position weights and unrealised gains/losses when purchase prices are supplied.
- Mutual-fund overlap when official portfolio disclosures are available.
- Diversification and risk observations.

No holding, purchase price or risk tolerance will be assumed.`;
}

function buildFundProjection(query: string): string {
  const monthly = parseMoney(query, /(?:sip|monthly|per month)\s*(?:of|amount|investment)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i)
    ?? parseMoney(query, /(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(?:monthly\s*)?sip/i)
    ?? parseMoney(query, /(?:invest)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(?:monthly|per month)/i);
  const lumpSum = parseMoney(query, /(?:lump.?sum|one.?time)\s*(?:of|amount|investment)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/i);
  const years = Number(query.match(/\b(\d{1,2})\s*[- ]?years?\b/i)?.[1] ?? 0);
  if ((!monthly && !lumpSum) || !years) return `# Mutual Fund Projection Inputs Needed\n\nProvide an SIP or lump-sum amount and duration—for example, “₹5,000 SIP for 10 years.” Optionally provide assumed return and inflation. Projections are hypothetical and not fund recommendations or guaranteed returns.`;
  const scenarios = [8, 10, 12].map((annualRate) => {
    const months = years * 12;
    const monthlyRate = annualRate / 100 / 12;
    const sipValue = monthly ? monthly * (((1 + monthlyRate) ** months - 1) / monthlyRate) * (1 + monthlyRate) : 0;
    const lumpValue = lumpSum ? lumpSum * (1 + annualRate / 100) ** years : 0;
    return { annualRate, value: sipValue + lumpValue };
  });
  const invested = (monthly ?? 0) * years * 12 + (lumpSum ?? 0);
  return `# Hypothetical SIP / Lump-Sum Projection

| Input | Value |
|---|---:|
| Monthly SIP | ${monthly ? money(monthly) : 'None'} |
| Lump sum | ${lumpSum ? money(lumpSum) : 'None'} |
| Duration | ${years} years |
| Total contribution | ${money(invested)} |

| Assumed annual return | Hypothetical future value |
|---:|---:|
${scenarios.map((scenario) => `| ${scenario.annualRate}% | ${money(Math.round(scenario.value))} |`).join('\n')}

> These are mathematical scenarios, not forecasts. Actual mutual-fund returns are volatile and affected by timing, expense ratios, tracking error, taxes and exit loads. Inflation is not included unless explicitly modelled. Scheme suitability requires objective, horizon and risk information.`;
}

function parseMoney(query: string, pattern: RegExp): number | undefined {
  const match = query.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
