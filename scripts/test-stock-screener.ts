import { prisma } from '../lib/database/client';
import { extractScreenerOrdinalRef, isStockScreeningQuery } from '../lib/screener/intent-classifier';
import { mergeScreenerFollowUp, parseNaturalLanguageScreen, validateScreenerSpec } from '../lib/screener/nl-parser';
import { evaluateScreenerCandidates } from '../lib/screener/evaluator';
import { buildScreenerCsv } from '../lib/screener/export-service';
import { runStockScreener } from '../lib/screener/service';
import { deleteSavedScreener, listSavedScreeners, saveScreenerSpec } from '../lib/screener/repository';
import { planExecutionTask } from '../lib/ai/orchestrator/task-classifier';
import type { ScreenerCandidateRow } from '../types/screener';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`✅ [PASS] ${name}`);
    passed += 1;
  } else {
    console.error(`❌ [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
}

function makeMockCandidate(overrides: Partial<ScreenerCandidateRow>): ScreenerCandidateRow {
  return {
    companyId: 'c1',
    isin: 'INE000A01010',
    name: 'Test Equity Ltd',
    primaryTicker: 'TESTEQ',
    nseSymbol: 'TESTEQ',
    bseCode: '500001',
    exchangeLabel: 'NSE/BSE',
    segment: 'mainboard',
    sector: 'Financial Services',
    industry: 'Banking',
    price: 1500,
    previousClose: 1480,
    changePct: 1.35,
    sma5: 1490,
    sma10: 1470,
    sma20: 1450,
    sma50: 1400,
    sma100: 1350,
    sma200: 1300,
    ema9: 1485,
    ema20: 1455,
    ema50: 1410,
    ema100: 1360,
    ema200: 1310,
    diffFromSma50Pct: 7.14,
    prevCloseBelowSma50: false,
    rsi14: 58,
    macd: 12,
    macdSignal: 8,
    macdHistogram: 4,
    stochasticK: 65,
    atrPct: 1.8,
    bbWidthPct: 6.5,
    dailyVolumeShares: 3_500_000,
    dailyTurnoverCr: 525,
    avgVolume5d: 3_000_000,
    avgVolume20d: 2_200_000,
    avgVolume50d: 2_000_000,
    relativeVolume: 1.59,
    volumeMode: 'latest_completed_session',
    high52W: 1600,
    low52W: 1100,
    distanceFrom52WeekHighPct: 6.25,
    distanceFrom52WeekLowPct: 36.36,
    higherHighsLows: true,
    supportLevel: 1420,
    resistanceLevel: 1560,
    marketCapCr: 150_000,
    marketCapSource: 'upstox_price_x_shares',
    sharesOutstanding: 1_000_000_000,
    roePct: 18.5,
    rocePct: 21.0,
    roaPct: 2.1,
    grossMarginPct: null,
    ebitdaMarginPct: null,
    operatingMarginPct: 24,
    netMarginPct: 19,
    revenueGrowthPct: 15,
    operatingProfitGrowthPct: null,
    netProfitGrowthPct: 18,
    epsGrowthPct: 18,
    cagr3yPct: null,
    cagr5yPct: null,
    debtToEquity: 0.35,
    currentRatio: 1.5,
    interestCoverage: null,
    operatingCashFlowCr: 5000,
    freeCashFlowCr: 3500,
    netDebtCr: -2000,
    pe: 22,
    pb: 3.1,
    evToEbitda: null,
    peg: null,
    dividendYieldPct: 1.2,
    promoterHoldingPct: 51,
    promoterPledgePct: 0,
    fiiHoldingPct: 22,
    diiHoldingPct: 18,
    fundamentalPeriod: 'TTM',
    fundamentalBasis: 'consolidated',
    quoteProvider: 'upstox',
    candleProvider: 'upstox',
    fundamentalProvider: 'yahoo_finance',
    dataFreshness: 'latest_completed_session',
    priceTimestamp: new Date().toISOString(),
    candleDate: '2026-11-25',
    conditionResults: [],
    matched: false,
    missingData: [],
    ...overrides,
  };
}

async function runTests() {
  console.log('======================================================================');
  console.log('📊 JARO AI — NATURAL LANGUAGE STOCK SCREENER REGRESSION SUITE');
  console.log('======================================================================\n');

  // Test 1: Exact screenshot query routing & parsing
  const screenshotQuery = 'List me the stocks that are having 50 days above moving average, daily trading volume should be more than 20 Lakhs and the market cap is above 100000 Cr.';
  assert(isStockScreeningQuery(screenshotQuery), 'Detects exact screenshot query as stock screening');

  const planned = await planExecutionTask({
    query: screenshotQuery,
    context: { activeCompanies: [] },
    hasDocuments: false,
  });
  assert(
    planned.path === 'stock_screening' && planned.classification.intent === 'stock_screening',
    'Routes exact screenshot query to stock_screening (never Breakout & Retest)',
    `Got path=${planned.path}, intent=${planned.classification.intent}`,
  );

  const spec1 = parseNaturalLanguageScreen(screenshotQuery);
  const val1 = validateScreenerSpec(spec1);
  assert(val1.valid, 'Validates screenshot query spec cleanly');
  assert(
    spec1.conditions.some((c) => c.field === 'daily_close' && c.operator === '>' && c.referenceField === 'sma_50'),
    'Parses Close > SMA 50 condition',
  );
  assert(
    spec1.conditions.some((c) => c.field === 'daily_volume' && c.operator === '>' && c.value === 2_000_000),
    'Parses Daily Volume > 20 Lakhs (2,000,000 shares)',
  );
  assert(
    spec1.conditions.some((c) => c.field === 'market_cap_cr' && c.operator === '>' && c.value === 100_000),
    'Parses Market Cap > 100000 Cr',
  );
  assert(spec1.logicalOperator === 'AND', 'Defaults logical operator to AND');

  // Test 2: Moving average distinctions
  const maSma50 = parseNaturalLanguageScreen('Find stocks above SMA 50');
  const maEma20 = parseNaturalLanguageScreen('Find stocks above EMA 20');
  const maCross50_200 = parseNaturalLanguageScreen('Find companies with 50-day SMA above 200-day SMA');
  const maBoth = parseNaturalLanguageScreen('Find stocks with price above SMA 50 and SMA 200');
  const maCrossing = parseNaturalLanguageScreen('Find stocks crossing above SMA 50');
  assert(maSma50.conditions[0]?.referenceField === 'sma_50', 'Distinguishes SMA 50');
  assert(maEma20.conditions[0]?.referenceField === 'ema_20', 'Distinguishes EMA 20');
  assert(
    maCross50_200.conditions[0]?.field === 'sma_50' && maCross50_200.conditions[0]?.referenceField === 'sma_200',
    'Parses SMA 50 > SMA 200 separately from Close > SMA 50',
  );
  assert(maBoth.conditions.length >= 2, 'Parses multiple moving average conditions');
  assert(maCrossing.conditions[0]?.operator === 'crosses_above', 'Parses crossing above SMA 50');

  // Test 3: Volume modes & shares vs turnover
  const vShares = parseNaturalLanguageScreen('Stocks with daily volume above 20 lakh shares');
  const vTurnover = parseNaturalLanguageScreen('Stocks with daily turnover above ₹20 crore');
  const vAvg20 = parseNaturalLanguageScreen('Stocks with 20-day average daily volume above 20 lakh');
  const vRvol = parseNaturalLanguageScreen('Stocks with relative volume above 1.5');
  const vIntraday = parseNaturalLanguageScreen('Stocks with current intraday volume above 10 lakh');
  assert(vShares.conditions[0]?.field === 'daily_volume' && vShares.conditions[0]?.value === 2_000_000, 'Parses shares volume');
  assert(vTurnover.conditions[0]?.field === 'daily_turnover_cr' && vTurnover.conditions[0]?.value === 20, 'Distinguishes INR turnover from shares');
  assert(vAvg20.conditions[0]?.field === 'avg_volume_20d', 'Parses 20-day average volume');
  assert(vRvol.conditions[0]?.field === 'relative_volume' && vRvol.conditions[0]?.value === 1.5, 'Parses relative volume');
  assert(vIntraday.volumeMode === 'intraday_cumulative' && vIntraday.conditions[0]?.field === 'intraday_volume', 'Parses intraday volume mode');

  // Test 4: Market cap normalization
  const mc1 = parseNaturalLanguageScreen('Stocks with market cap above ₹1 lakh crore');
  const mc2 = parseNaturalLanguageScreen('Stocks with market cap between ₹10,000 crore and ₹50,000 crore');
  const mc3 = parseNaturalLanguageScreen('Stocks with market cap below ₹5,000 crore');
  assert(mc1.conditions[0]?.value === 100_000, 'Normalizes ₹1 lakh crore to 100,000 Cr');
  assert(mc2.conditions[0]?.operator === 'between' && mc2.conditions[0]?.value === 10_000 && mc2.conditions[0]?.valueTo === 50_000, 'Normalizes market cap range');
  assert(mc3.conditions[0]?.operator === '<' && mc3.conditions[0]?.value === 5_000, 'Normalizes below ₹5,000 Cr');

  // Test 5: Deterministic Evaluator (strict AND, missing-data exclusion, CSV)
  const goodRow = makeMockCandidate({ companyId: 'pass1', primaryTicker: 'GOOD', nseSymbol: 'GOOD' });
  const twoOfThree = makeMockCandidate({ companyId: 'fail1', primaryTicker: 'LOWVOL', dailyVolumeShares: 500_000 });
  const missingMcap = makeMockCandidate({ companyId: 'fail2', primaryTicker: 'NOMCAP', marketCapCr: null });

  const evalRes = evaluateScreenerCandidates([goodRow, twoOfThree, missingMcap], spec1);
  assert(evalRes.matched.length === 1 && evalRes.matched[0].companyId === 'pass1', 'Strict AND evaluator matches only securities passing ALL conditions');
  assert(evalRes.unavailableCount === 1, 'Records missing market cap as unavailable rather than passing');

  const csv = buildScreenerCsv(evalRes.matched);
  assert(csv.includes('Test Equity Ltd') && csv.includes('GOOD') && csv.includes('upstox'), 'Builds RFC-4180 CSV with provenance');

  // Test 6: Follow-ups & Ordinal Drill-Down
  const followSector = mergeScreenerFollowUp(spec1, 'Show only the banking companies');
  const followNse = mergeScreenerFollowUp(followSector, 'Only NSE stocks');
  const followVol = mergeScreenerFollowUp(followNse, 'Change volume to 50 lakhs');
  const followSort = mergeScreenerFollowUp(followVol, 'Sort by highest ROCE');
  assert(followSort.sector === 'Banking' && followSort.exchanges === 'NSE', 'Preserves prior filters across sector and exchange follow-ups');
  assert(followSort.conditions.some((c) => c.field === 'daily_volume' && c.value === 5_000_000), 'Updates volume threshold cleanly in follow-up');
  assert(followSort.sortBy === 'roce_pct', 'Updates sort field to ROCE in follow-up');
  assert(
    !isStockScreeningQuery('Explain the fundamentals of the first stock', { activeCompanies: [], lastIntent: 'stock_screening', activeScreenerSpec: spec1 })
      && extractScreenerOrdinalRef('Explain the fundamentals of the first stock') === 0,
    'Routes ordinal drill-down ("first stock") to company research instead of screener',
  );

  // Test 7: Saved Screener Persistence & Tenant Isolation
  const savedA = await saveScreenerSpec({ ownerKey: 'scr_owner_a', name: 'Test Large Cap Trend', spec: spec1, lastMatchCount: 5 });
  const listA = await listSavedScreeners('scr_owner_a');
  const listB = await listSavedScreeners('scr_owner_b');
  assert(listA.some((s) => s.id === savedA.id) && listB.length === 0, 'Saved screeners enforce strict ownerKey tenant isolation');
  await deleteSavedScreener('scr_owner_a', savedA.id);

  // Test 8: End-to-End Live Screener Execution on Exact Screenshot Query
  console.log('\n--- Running Live End-to-End Stock Screener on Screenshot Query ---');
  const liveResult = await runStockScreener({ query: screenshotQuery });
  assert(liveResult.spec.intent === 'stock_screening', 'End-to-end execution stays in stock_screening');
  assert(liveResult.coverage.totalEligibleSecurities > 0 && liveResult.coverage.validQuoteCount > 0, `Evaluated ${liveResult.coverage.validQuoteCount}/${liveResult.coverage.totalEligibleSecurities} eligible securities`);
  assert(liveResult.executionTimestampIst.includes('IST'), 'Includes verified Asia/Kolkata IST timestamp');
  assert(liveResult.rows.every((r) => r.price > (r.sma50 ?? 0) && (r.dailyVolumeShares ?? 0) > 2_000_000 && (r.marketCapCr ?? 0) > 100_000), 'Every returned stock satisfies Close > SMA50, Volume > 20L, and Market Cap > 100,000 Cr');
  console.log(`ℹ️  Live matched stocks: ${liveResult.rows.map((r) => `${r.nseSymbol ?? r.primaryTicker} (₹${r.price.toFixed(1)}, SMA50 ₹${r.sma50?.toFixed(1)}, Vol ${(Number(r.dailyVolumeShares ?? 0) / 1e5).toFixed(1)}L, MCap ₹${Math.round(r.marketCapCr ?? 0)}Cr)`).slice(0, 8).join('; ')}`);

  await prisma.screenerJobRun.deleteMany({ where: { jobId: liveResult.jobId } }).catch(() => {});

  console.log('\n======================================================================');
  console.log(`📊 SCREENER TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================');
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('Fatal screener test failure:', err);
  process.exitCode = 1;
});
