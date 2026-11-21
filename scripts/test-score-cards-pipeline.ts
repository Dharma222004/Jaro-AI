import { scoreFundamentals, scoreValuation, scoreTechnicals, scoreRisk } from '../lib/decision/scoring';
import type { ResearchReport } from '../types/research';
import type { TechnicalAnalysisResult } from '../types/technical';

function runScoreCardsTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('JARO AI — SCORE CARDS DATA BINDING & MODEL VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} — ${detail ?? ''}`);
      failed++;
    }
  }

  // Create mock research report for a standard Indian listed company
  const mockReport = {
    company: {
      name: 'V2 Retail Limited',
      ticker: 'V2RETAIL',
      exchange: 'NSE',
      description: 'Value Fashion & Apparel Retail',
      isin: 'INE945H01021',
      sector: 'Consumer Discretionary',
      industry: 'Value Fashion & Apparel Retail',
      screenerSlug: 'V2RETAIL',
    },
    financials: {
      revenue: { value: 1250, unit: 'Cr', period: 'FY25' },
      ebitda: { value: 165, unit: 'Cr', period: 'FY25' },
      profit: { value: 72, unit: 'Cr', period: 'FY25' },
      eps: { value: 18.2, unit: 'INR', period: 'FY25' },
      revenueGrowth: { value: 24.5, unit: '%', period: 'FY25' },
      profitGrowth: { value: 38.2, unit: '%', period: 'FY25' },
      debtToEquity: { value: 0.15, unit: 'x', period: 'FY25' },
      debt: { value: 45, unit: 'Cr', period: 'FY25' },
      cash: { value: 80, unit: 'Cr', period: 'FY25' },
      cashFlow: { value: 110, unit: 'Cr', period: 'FY25' },
      freeCashFlow: { value: 65, unit: 'Cr', period: 'FY25' },
    },
    profitability: {
      roe: { value: 18.5, unit: '%', period: 'FY25' },
      roce: { value: 21.2, unit: '%', period: 'FY25' },
      netMargin: { value: 5.76, unit: '%', period: 'FY25' },
      ebitdaMargin: { value: 13.2, unit: '%', period: 'FY25' },
    },
    valuation: {
      pe: { value: 26.4, unit: 'x', period: 'TTM' },
      pb: { value: 3.8, unit: 'x', period: 'TTM' },
      marketCap: { value: 4500, unit: 'Cr', period: 'TTM' },
      evEbitda: { value: 12.5, unit: 'x', period: 'TTM' },
      dividendYield: { value: 0.8, unit: '%', period: 'FY25' },
    },
    shareholding: {
      promoter: { value: 54.2, unit: '%', period: 'Dec 2024' },
      fii: { value: 8.5, unit: '%', period: 'Dec 2024' },
      dii: { value: 12.1, unit: '%', period: 'Dec 2024' },
      public: { value: 25.2, unit: '%', period: 'Dec 2024' },
      pledged: { value: 0, unit: '%', period: 'Dec 2024' },
    },
    risks: [
      { risk: 'Competition', category: 'Operational', severity: 'medium', description: 'Intense regional retail competition' },
    ],
    strengths: ['Robust revenue expansion', 'Low corporate debt'],
    executiveSummary: 'Positive growth with disciplined balance sheet.',
    researchSummary: 'Strong fundamental trajectory with manageable debt.',
    sources: [],
    retrievedAt: new Date().toISOString(),
  } as unknown as ResearchReport;

  // Mock technical analysis result
  const mockPrimary = {
    instrument: {
      segment: 'NSE_EQ',
      name: 'V2 RETAIL LIMITED',
      exchange: 'NSE',
      trading_symbol: 'V2RETAIL',
      instrument_type: 'EQ',
      instrument_key: 'NSE_EQ|INE945H01021',
    },
    timeframe: '1d',
    trend: 'bullish',
    dataStatus: 'live',
    retrievedAt: new Date().toISOString(),
    cacheHit: false,
    staleCache: false,
    expiresAt: '',
    candles: [
      { timestamp: '2026-03-01', open: 1200, high: 1260, low: 1190, close: 1250, volume: 150000, openInterest: 0 },
    ],
    indicators: {
      ema9: 1230,
      ema20: 1210,
      ema50: 1180,
      ema100: 1120,
      ema200: 1050,
      sma20: 1205,
      sma50: 1175,
      sma100: 1115,
      sma200: 1045,
      rsi14: 62.4,
      macd: 22.5,
      macdSignal: 18.2,
      macdHistogram: 4.3,
      adx14: 28.5,
      atr14: 32.5,
      atrPct: 2.6,
      relativeVolume: 1.35,
      support: 1180,
      resistance: 1280,
    },
    signals: [],
    bullishFindings: ['Price above 20, 50, and 200 EMAs', 'RSI in healthy bullish zone'],
    bearishFindings: [],
    neutralFindings: [],
    validation: {
      received: 200,
      accepted: 200,
      duplicatesRemoved: 0,
      rejectedInvalidTimestamp: 0,
      rejectedInvalidPrice: 0,
      rejectedInvalidOhlc: 0,
      rejectedInvalidVolume: 0,
      rejectedOutsideSession: 0,
      estimatedMissingIntervals: 0,
      timezoneOffsetsPresent: true,
      newestTimestamp: '2026-03-01',
    },
  } as unknown as TechnicalAnalysisResult;

  const mockConfirmation: TechnicalAnalysisResult = {
    ...mockPrimary,
    timeframe: '1w',
    trend: 'bullish',
  };

  // Test 1: Fundamental Score
  console.log('--- TEST 1: Fundamentals Score Card Model ---');
  const fundScore = scoreFundamentals(mockReport);
  assert(fundScore.category === 'Fundamentals', 'Category is "Fundamentals"');
  assert(typeof fundScore.score === 'number' && fundScore.score > 0, `Score is valid number (${fundScore.score})`);
  assert(fundScore.maxScore === 100, 'Max score is 100');
  assert(fundScore.coveragePct >= 70, `Coverage is calculated (${fundScore.coveragePct}%)`);
  assert(Boolean(fundScore.status && fundScore.status !== 'Insufficient data'), `Status is populated: ${fundScore.status}`);
  assert(Boolean(fundScore.summary && fundScore.explanation), 'Summary and explanation are populated');
  assert(fundScore.supportingMetrics.length >= 6, `Supporting metrics exist (${fundScore.supportingMetrics.length} metrics)`);
  assert(fundScore.supportingMetrics.every((m) => m.name && m.value), 'All supporting metrics have name and value');

  // Test 2: Valuation Score
  console.log('\n--- TEST 2: Valuation Score Card Model ---');
  const valScore = scoreValuation(mockReport);
  assert(valScore.category === 'Valuation', 'Category is "Valuation"');
  assert(typeof valScore.score === 'number', `Valuation score is valid number (${valScore.score})`);
  assert(valScore.supportingMetrics.some((m) => m.name === 'P/E'), 'P/E multiple is in supporting metrics');
  assert(valScore.supportingMetrics.some((m) => m.name === 'P/B'), 'P/B multiple is in supporting metrics');
  assert(valScore.supportingMetrics.some((m) => m.name === 'EV/EBITDA'), 'EV/EBITDA is in supporting metrics');

  // Test 3: Technical Score
  console.log('\n--- TEST 3: Technical Score Card Model ---');
  const techScore = scoreTechnicals(mockPrimary, mockConfirmation);
  assert(techScore.category === 'Technical', 'Category is "Technical"');
  assert(typeof techScore.score === 'number' && techScore.score >= 50, `Technical score is valid (${techScore.score})`);
  assert(techScore.supportingMetrics.some((m) => m.name === 'Primary trend'), 'Primary trend metric present');
  assert(techScore.supportingMetrics.some((m) => m.name === 'EMA alignment'), 'EMA alignment metric present');
  assert(techScore.supportingMetrics.some((m) => m.name === 'RSI condition'), 'RSI condition metric present');

  // Test 4: Risk Resilience Score
  console.log('\n--- TEST 4: Risk Resilience Score Card Model ---');
  const riskScore = scoreRisk(mockReport, mockPrimary);
  assert(riskScore.category === 'Risk Resilience', 'Category is "Risk Resilience"');
  assert(typeof riskScore.score === 'number', `Risk score is valid number (${riskScore.score})`);
  assert(riskScore.supportingMetrics.some((m) => m.name === 'Price volatility'), 'Price volatility metric present');
  assert(riskScore.supportingMetrics.some((m) => m.name === 'Promoter pledge'), 'Promoter pledge metric present');

  // Test 5: Incomplete data handling
  console.log('\n--- TEST 5: Incomplete / Missing Data Handling ---');
  const sparseReport = {
    ...mockReport,
    financials: {
      ...mockReport.financials,
      revenueGrowth: undefined,
      profitGrowth: undefined,
      freeCashFlow: undefined,
      cashFlow: { value: 0, unit: 'Cr' },
    },
    profitability: {
      ...mockReport.profitability,
      roe: undefined,
      roce: undefined,
    },
  } as unknown as ResearchReport;
  const sparseFundScore = scoreFundamentals(sparseReport);
  assert(sparseFundScore.coveragePct < 70, `Low data coverage correctly reported (${sparseFundScore.coveragePct}%)`);
  assert(sparseFundScore.missingData.length > 0, `Missing data identified: ${sparseFundScore.missingData.join(', ')}`);
  assert(sparseFundScore.supportingMetrics.some((m) => m.status === 'unavailable'), 'Unavailable metrics properly tagged');

  // Test 6: End-to-End Decision Engine QTVT Level Binding
  console.log('\n--- TEST 6: Decision Engine QTVT Data Binding ---');
  const { buildInvestmentDecision } = require('../lib/decision/engine');
  const mockQtvt = {
    symbol: 'V2RETAIL',
    horizon: 'SWING',
    as_of: new Date().toISOString(),
    cmp: 1250,
    atr: 25,
    verdict: 'WAIT_FOR_ENTRY',
    verdict_reason: 'Price extended above 2.0 ATR from support zone; waiting for pullback',
    score: 78,
    data_confidence: 'High',
    data_confidence_score: 90,
    sector_profile: 'Non-financial',
    fqs: { score: 82, maxScore: 100, status: 'Strong', factors: [], missingData: [] },
    vs: { score: 65, maxScore: 100, status: 'Acceptable', fairValue: { bear: 1100, base: 1400, bull: 1750, expectedReturnPct: 15, marginOfSafetyPct: 12, methodology: 'P/E' }, factors: [] },
    trend: { score: 85, rsScore: 80, marketRegimeScore: 75, participationScore: 80, factors: [] },
    setup: {
      type: 'Trend Pullback',
      state: 'EXTENDED',
      entry_zone_low: 1180,
      entry_zone_high: 1205,
      trigger: 1260,
      chase_limit: 1220,
      alert_price: 1205,
      invalidate_before_entry: 1120,
      expiry_sessions: 15,
      confluence_factors: ['EMA20', 'Prior Breakout Level'],
    },
    stop: {
      price: 1135,
      basis: 'Swing low - 0.75 ATR',
      distance_atr: 1.8,
      distance_pct: 5.8,
      trail_rule: 'Move to breakeven after Target 1',
      time_stop: 'Exit after 15 sessions if < +0.5R',
    },
    targets: [
      { id: 'T1', price: 1380, basis: 'Prior high', supported: true, r_net: 1.8, portion: 0.4, upside_pct: 10.4 },
      { id: 'T2', price: 1475, basis: '1.272 Fib extension', supported: true, r_net: 2.8, portion: 0.3, upside_pct: 18.0 },
      { id: 'T3', price: 1550, basis: 'Trailing runner (5 ATR reference)', supported: false, r_net: 3.5, portion: 0.3, upside_pct: 24.0 },
    ],
    rr: { at_cmp: 0.8, at_zone_mid: 2.2, at_chase_limit: 1.4, blended_net: 2.4, required_min: 1.2 },
    sizing: {
      risk_budget_pct: 1.0,
      max_risk_amount: 10000,
      shares: 142,
      position_value: 177500,
      portfolio_pct: 17.7,
      caps_applied: ['Single-stock cap applied'],
      notes: '142 shares at target entry',
    },
    gates: [],
    what_would_change_the_call: [],
    events: [],
    meta: { strategy_id: 'QTVT-2.0.0', policy_id: 'QTVT-POL-2026.1', release_status: 'live', data_versions: {} },
  };

  const decision = buildInvestmentDecision({
    query: 'V2RETAIL',
    company: mockReport.company,
    report: mockReport,
    primary: mockPrimary,
    daily: mockPrimary,
    sources: [],
    qtvt: mockQtvt,
  });

  assert(decision.preferredEntry != null, 'Preferred entry is generated from QTVT');
  assert(decision.preferredEntry.rangeLow === 1180 && decision.preferredEntry.rangeHigh === 1205, 'Entry zone bounds match QTVT setup (1180–1205)');
  assert(decision.stopLoss != null && decision.stopLoss.price === 1135, 'Stop loss price matches QTVT structural stop (1135)');
  assert(decision.targets.length === 3, 'All 3 QTVT targets bound to decision');
  assert(decision.targets[0].price === 1380 && decision.targets[0].riskReward === 1.8, 'Target 1 price (1380) and Net R/R (1.8) match QTVT');
  assert(decision.positionSizing != null && decision.positionSizing.quantity === 142, 'Position sizing shares (142) match QTVT sizing');
  assert(decision.fundamentalScore.score != null && decision.fundamentalScore.supportingMetrics.length > 0, 'Fundamental score card carries full metrics');
  assert(decision.valuationScore.score != null && decision.valuationScore.supportingMetrics.length > 0, 'Valuation score card carries full metrics');
  assert(decision.technicalScore.score != null && decision.technicalScore.supportingMetrics.length > 0, 'Technical score card carries full metrics');
  assert(decision.riskScore.score != null && decision.riskScore.supportingMetrics.length > 0, 'Risk score card carries full metrics');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`SCORE CARDS TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

runScoreCardsTest();
