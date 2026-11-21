import type { ResearchReport } from '@/types/research';
import type { CompanyIdentity } from '@/types/company';
import type { QtvtVsResult, QtvtFairValue, QtvtSectorProfile } from '@/types/qtvt';

export function computeValuationAndFairValue(params: {
  report: ResearchReport;
  company: CompanyIdentity;
  profile: QtvtSectorProfile;
  cmp: number;
}): QtvtVsResult {
  const { report, profile, cmp } = params;

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const peVal = num(report.valuation?.pe?.value);
  const pbVal = num(report.valuation?.pb?.value);
  const evEbitdaVal = num(report.valuation?.evEbitda?.value);
  const roeVal = num(report.profitability?.roe?.value) ?? 14;
  const divYieldVal = num(report.valuation?.dividendYield?.value) ?? 0;

  // Derive EPS and Book Value from CMP and multiples
  const eps = peVal && peVal > 0 ? cmp / peVal : num(report.financials?.eps?.value) ?? cmp / 25;
  const bv = pbVal && pbVal > 0 ? cmp / pbVal : cmp / 3;

  let fairValueBase = cmp;
  let methodology = '';

  if (profile === 'Banks/NBFC') {
    // Justified P/B model for financial lending institutions:
    // Justified P/B = (RoE - g) / (CoE - g)
    // Baseline: Cost of Equity (CoE) = 13.0%, Sustainable Growth (g) = 8.0%
    const roeDecimal = Math.max(0.05, Math.min(0.25, roeVal / 100));
    const coe = 0.13;
    const g = 0.08;
    const justifiedPB = Math.max(0.8, Math.min(3.5, (roeDecimal - g) / (coe - g)));
    fairValueBase = Math.round(bv * justifiedPB * 10) / 10;
    methodology = `Justified P/B model (${justifiedPB.toFixed(2)}x justified on ${roeVal.toFixed(1)}% RoE, 13% CoE, 8% terminal growth)`;
  } else {
    // Earnings Multiple model for non-financials
    // Target P/E anchored by sustainable growth and capital efficiency
    let targetPe = 22;
    if (peVal != null) {
      targetPe = Math.max(14, Math.min(35, peVal * 0.95)); // conservative 5% haircut to current if reasonable
    }
    const forwardEps = eps * 1.12; // 12% forward earnings growth estimate
    fairValueBase = Math.round(forwardEps * targetPe * 10) / 10;
    methodology = `Discounted Multiple framework (${targetPe.toFixed(1)}x forward P/E on 12% projected EPS compounding)`;
  }

  // Ensure fair value base is sane
  if (!Number.isFinite(fairValueBase) || fairValueBase <= 0) {
    fairValueBase = cmp;
  }

  const bear = Math.round(fairValueBase * 0.82 * 10) / 10;
  const bull = Math.round(fairValueBase * 1.28 * 10) / 10;

  const expectedReturnPct = Math.round(((fairValueBase - cmp) / cmp) * 1000) / 10;
  const marginOfSafetyPct = Math.round(((fairValueBase - cmp) / fairValueBase) * 1000) / 10;

  const fairValue: QtvtFairValue = {
    bear,
    base: fairValueBase,
    bull,
    expectedReturnPct,
    marginOfSafetyPct,
    methodology,
  };

  // Compute sub-factors and VS score (0-100)
  const factors: Array<{ name: string; score: number; weight: number; evidence: string }> = [];
  let totalScore = 0;
  let totalWeight = 0;

  // 1. Margin of Safety (40 pts)
  let mosScore = 20;
  if (marginOfSafetyPct >= 20) mosScore = 40;
  else if (marginOfSafetyPct >= 10) mosScore = 32;
  else if (marginOfSafetyPct >= 0) mosScore = 25;
  else if (marginOfSafetyPct >= -15) mosScore = 15;
  else mosScore = 5;

  factors.push({
    name: 'Margin of Safety to Base Fair Value',
    score: mosScore,
    weight: 40,
    evidence: `Base Fair Value ₹${fairValueBase} vs CMP ₹${cmp} (${marginOfSafetyPct >= 0 ? `+${marginOfSafetyPct}% MoS` : `${marginOfSafetyPct}% premium`}).`,
  });
  totalScore += mosScore;
  totalWeight += 40;

  // 2. Absolute Multiple Sanity (30 pts)
  let multipleScore = 15;
  if (peVal != null) {
    if (peVal <= 20) multipleScore = 30;
    else if (peVal <= 35) multipleScore = 22;
    else if (peVal <= 50) multipleScore = 14;
    else multipleScore = 6;
  }
  factors.push({
    name: 'Valuation Multiple Headroom (P/E)',
    score: multipleScore,
    weight: 30,
    evidence: peVal != null ? `P/E multiple at ${peVal.toFixed(1)}x.` : 'Trailing P/E unverified.',
  });
  totalScore += multipleScore;
  totalWeight += 30;

  // 3. Asset & Yield Support (30 pts: P/B, FCF / Dividend)
  let yieldScore = 15;
  if (divYieldVal >= 2.0) yieldScore += 10;
  else if (divYieldVal >= 1.0) yieldScore += 5;
  if (pbVal != null && pbVal <= 3.0) yieldScore += 5;
  yieldScore = Math.min(30, yieldScore);

  factors.push({
    name: 'Asset & Cash Flow Backing',
    score: yieldScore,
    weight: 30,
    evidence: `P/B: ${pbVal != null ? `${pbVal.toFixed(1)}x` : 'N/A'}, Div Yield: ${divYieldVal.toFixed(1)}%.`,
  });
  totalScore += yieldScore;
  totalWeight += 30;

  const score = Math.round((totalScore / totalWeight) * 100);
  const status = score >= 75 ? 'Strong' : score >= 60 ? 'Acceptable' : score >= 40 ? 'Mixed' : 'Weak';

  // Benchmark 10Y G-Sec is currently ~7.10%
  const earningsYield = peVal && peVal > 0 ? (1 / peVal) * 100 : null;
  const gsecSpreadBps = earningsYield != null ? Math.round((earningsYield - 7.1) * 100) : null;

  return {
    score,
    maxScore: 100,
    status,
    fairValue,
    factors,
    pePercentile: peVal != null ? Math.min(99, Math.max(1, Math.round(peVal * 1.5))) : null,
    pbPercentile: pbVal != null ? Math.min(99, Math.max(1, Math.round(pbVal * 15))) : null,
    gsecSpreadBps,
  };
}
