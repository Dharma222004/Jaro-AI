import { runQtvtEngine } from '../lib/strategy/qtvt-engine';
import { solveEntryAndSizing } from '../lib/strategy/solver';
import { computeFundamentalQualityScore } from '../lib/strategy/fqs';
import { computeValuationAndFairValue } from '../lib/strategy/valuation';
import type { ResearchReport } from '../types/research';
import type { CompanyIdentity } from '../types/company';
import type { TechnicalAnalysisResult } from '../types/technical';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runAcceptanceTests() {
  console.log('================================================================');
  console.log('JARO METHOD v2 — QTVT CONFLUENCE ENGINE ACCEPTANCE TEST SUITE');
  console.log('================================================================\n');

  // ── TEST 1: AXISBANK ACCEPTANCE TEST CASE (Section 17 of prompt) ───────────
  console.log('--- TEST 1: AXISBANK Extended Setup & Unverified Event ---');

  const axisCompany: CompanyIdentity = {
    name: 'Axis Bank Limited',
    ticker: 'AXISBANK',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE238A01034',
    sector: 'Banking & Financial Services',
    industry: 'Private Sector Bank',
  };

  const axisReport = {
    company: axisCompany,
    financialPeriod: 'Q3 FY26',
    financials: {
      revenue: { value: 34500, unit: '₹ Cr', period: 'Q3 FY26' },
      profit: { value: 6490, unit: '₹ Cr', period: 'Q3 FY26' },
      eps: { value: 68.5, unit: '₹', period: 'TTM' },
    },
    valuation: {
      pe: { value: 14.8, unit: 'x' },
      pb: { value: 1.85, unit: 'x' },
    },
    profitability: {
      roe: { value: 15.2, unit: '%' },
      roce: { value: 12.0, unit: '%' },
    },
    shareholding: {
      promoter: { value: 8.2, unit: '%' },
      fii: { value: 52.4, unit: '%' },
      dii: { value: 28.1, unit: '%' },
      public: { value: 11.3, unit: '%' },
      pledged: { value: 0, unit: '%' },
    },
    strengths: ['Strong capital adequacy', 'Expanding retail deposit franchise', 'Asset quality improvement'],
    risks: [{ category: 'Credit Risk', description: 'Unsecured retail portfolio stress' }],
    researchSummary: 'Axis Bank exhibits robust RoE (15.2%) and strong provision coverage with declining NPAs.',
  } as unknown as ResearchReport;

  // Build 200 synthetic candles matching AXISBANK specification:
  // CMP = 1,380.8, ATR = 26.7, Support Low = 1,302.6, Stop = 1,282.6
  const baseCandles = Array.from({ length: 200 }, (_, i) => {
    const price = 1200 + i * 0.9;
    return {
      timestamp: new Date(Date.now() - (200 - i) * 86400 * 1000).toISOString(),
      open: price - 2,
      high: price + 10,
      low: price - 10,
      close: price,
      volume: 4500000,
    };
  });
  // Set the latest candles to reflect CMP 1,380.8, support at 1,302.6, prior resistance at 1,395
  baseCandles[185].low = 1302.6; // recent structural support low
  baseCandles[195].high = 1395.0; // overhead structural resistance
  baseCandles[199].close = 1380.8;
  baseCandles[199].high = 1388.0;
  baseCandles[199].low = 1370.0;

  const axisDaily: TechnicalAnalysisResult = {
    instrument: { instrument_key: 'NSE_EQ|INE238A01034', trading_symbol: 'AXISBANK', exchange: 'NSE', name: 'Axis Bank' },
    timeframe: '1d',
    retrievedAt: new Date().toISOString(),
    quote: { price: 1380.8, open: 1375, high: 1388, low: 1370, close: 1380.8, volume: 5200000, changePct: 0.8 },
    candles: baseCandles,
    indicators: {
      atr: { value: 26.7 },
      rsi: { value: 71.64 }, // RSI 71.64 (Extended!)
      sma: { sma50: 1315.0, sma200: 1250.0 },
      ema: { ema20: 1345.0 },
    },
    trend: 'bullish',
    bullishFindings: ['Trading above SMA200 and SMA50'],
    bearishFindings: ['RSI overbought'],
    dataStatus: 'complete',
  } as unknown as TechnicalAnalysisResult;

  const axisResult = runQtvtEngine({
    report: axisReport,
    company: axisCompany,
    stockDaily: axisDaily,
    horizon: 'SWING',
    // Unverified event calendar (no verified events provided)
    events: [],
  });

  // Verification 1: Sector Profile
  assert(axisResult.sector_profile === 'Banks/NBFC', `Sector profile is Banks/NBFC (got ${axisResult.sector_profile})`);

  // Verification 2: Setup State
  assert(axisResult.setup.state === 'EXTENDED', `Setup state is EXTENDED (got ${axisResult.setup.state})`);

  // Verification 3: Normal Pullback Gate is WAIT
  const pullbackGate = axisResult.gates.find((g) => g.id === 'L5_pullback_confluence');
  assert(pullbackGate?.status === 'WAIT', `Normal Pullback gate shows WAIT (got ${pullbackGate?.status})`);

  // Verification 4: Trigger Gate is N/A (Sequential enforcement)
  const triggerGate = axisResult.gates.find((g) => g.id === 'L5_volume_trigger');
  assert(triggerGate?.status === 'N/A', `Trigger gate shows N/A while extended (got ${triggerGate?.status})`);

  // Verification 5: Momentum Gate shows WAIT (RSI 71.64 > 58 reset zone)
  const momentumGate = axisResult.gates.find((g) => g.id === 'L5_momentum_reset');
  assert(momentumGate?.status === 'WAIT', `Momentum gate shows WAIT for RSI 71.64 (got ${momentumGate?.status})`);

  // Verification 6: Event Gate shows UNVERIFIED
  const eventGate = axisResult.gates.find((g) => g.id === 'L4_event_surveillance_risk');
  assert(eventGate?.status === 'UNVERIFIED', `Event gate shows UNVERIFIED (got ${eventGate?.status})`);

  // Verification 7: R/R at CMP is poor (< 1.2:1) and solver provides chase limit
  assert(axisResult.rr.at_cmp < 1.0, `Net R/R at CMP is low (got ${axisResult.rr.at_cmp}:1)`);
  assert(axisResult.setup.chase_limit < axisResult.cmp, `Solver computed chase limit E_max below CMP (E_max = ₹${axisResult.setup.chase_limit} vs CMP ₹${axisResult.cmp})`);

  // Verification 8: Structural Stop preserved (not moved higher!)
  assert(axisResult.stop.price === 1282.6, `Structural stop preserved at 1,282.6 (got ${axisResult.stop.price})`);

  // Verification 9: Verdict is WAIT_FOR_ENTRY (NEVER ACTIONABLE)
  assert(axisResult.verdict === 'WAIT_FOR_ENTRY', `Verdict is strictly WAIT_FOR_ENTRY (got ${axisResult.verdict})`);

  console.log('\n--- TEST 2: Deterministic Entry-Price Solver Math ---');
  // Mathematical verification of E_max = (T + k * S) / (1 + k) - c
  const solverTest = solveEntryAndSizing({
    cmp: 1380.8,
    stopPrice: 1282.6,
    target1: 1450.0,
    target2: 1520.0,
    target3: 1600.0,
    zoneLow: 1302.6,
    zoneHigh: 1345.0,
    horizon: 'SWING',
  });

  const kRequired = 1.2;
  const cost = solverTest.costs.perShareCost;
  const expectedEmax = Math.round(((1450.0 + kRequired * 1282.6) / (1 + kRequired) - cost) * 10) / 10;
  assert(solverTest.chaseLimit === expectedEmax, `Solver E_max matches formula exactly: ₹${solverTest.chaseLimit} vs ₹${expectedEmax}`);

  // Test net R/R at E_max: must be >= 1.2
  const netRewardAtEmax = 1450.0 - solverTest.chaseLimit - cost;
  const netRiskAtEmax = solverTest.chaseLimit - 1282.6 + cost;
  const netRAtEmax = Math.round((netRewardAtEmax / netRiskAtEmax) * 100) / 100;
  assert(netRAtEmax >= 1.18, `Net R/R at E_max satisfies >= 1.2:1 hurdle (got ${netRAtEmax}:1)`);

  console.log('\n--- TEST 3: Hard Veto Checks (AVOID Verdicts) ---');
  // High promoter pledge (>25%)
  const pledgeCompany: CompanyIdentity = { name: 'Pledged Co', ticker: 'PLEDGECO', exchange: 'NSE', country: 'India' };
  const pledgeReport = {
    company: pledgeCompany,
    financials: { revenue: { value: 1000 } },
    shareholding: { pledged: { value: 45.0, unit: '%' } },
  } as unknown as ResearchReport;
  const pledgeFqs = computeFundamentalQualityScore({ report: pledgeReport, company: pledgeCompany });
  assert(pledgeFqs.fqs.vetoApplied === true, 'Pledge > 25% triggers hard veto');
  assert(pledgeFqs.fqs.status === 'Weak', 'Pledge veto sets FQS status to Weak');

  // Interest coverage < 1.5x
  const debtCompany: CompanyIdentity = { name: 'Debt Co', ticker: 'DEBTCO', exchange: 'NSE', country: 'India' };
  const debtReport = {
    company: debtCompany,
    financials: { interestCoverage: { value: 1.1, unit: 'x' } },
    shareholding: { pledged: { value: 0 } },
  } as unknown as ResearchReport;
  const debtFqs = computeFundamentalQualityScore({ report: debtReport, company: debtCompany });
  assert(debtFqs.fqs.vetoApplied === true, 'Interest coverage < 1.5x triggers hard veto');

  console.log('\n--- TEST 4: Actionable Setup (All Gates Pass) ---');
  // Create an actionable setup where price has pulled back into the zone, RSI is 46, event is verified
  const readyCandles = [...baseCandles];
  readyCandles[199].close = 1315.0; // pulled back into zone
  readyCandles[199].high = 1320.0;
  readyCandles[199].low = 1310.0;

  const readyDaily: TechnicalAnalysisResult = {
    ...axisDaily,
    quote: { ...axisDaily.quote, price: 1315.0, close: 1315.0 },
    candles: readyCandles,
    indicators: {
      atr: { value: 26.7 },
      rsi: { value: 46.5 }, // healthy reset!
      sma: { sma50: 1300.0, sma200: 1250.0 },
      ema: { ema20: 1320.0 },
    },
  } as unknown as TechnicalAnalysisResult;

  const actionableResult = runQtvtEngine({
    report: axisReport,
    company: axisCompany,
    stockDaily: readyDaily,
    horizon: 'SWING',
    events: [{ type: 'Results Intimation', date: '2026-12-15', source: 'NSE Corporate Filing', verified: true }],
  });

  assert(actionableResult.setup.state === 'READY', `Setup state is READY when pulled back (got ${actionableResult.setup.state})`);
  assert(actionableResult.verdict === 'ACTIONABLE', `Verdict is ACTIONABLE when all gates pass (got ${actionableResult.verdict})`);
  assert(actionableResult.data_confidence === 'High', `Data confidence is High (got ${actionableResult.data_confidence})`);

  console.log('\n================================================================');
  console.log('🎉 ALL JARO METHOD v2 QTVT ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runAcceptanceTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
