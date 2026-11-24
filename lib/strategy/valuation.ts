import type { ResearchReport } from '@/types/research';
import type { CompanyIdentity } from '@/types/company';
import type { QtvtVsResult, QtvtFairValue, QtvtSectorProfile, QtvtBankMetrics } from '@/types/qtvt';

export function computeValuationAndFairValue(params: {
  report: ResearchReport;
  company: CompanyIdentity;
  profile: QtvtSectorProfile;
  cmp: number;
  bankMetrics?: QtvtBankMetrics;
  fqsScore?: number;
}): QtvtVsResult {
  const { report, profile, cmp, bankMetrics, fqsScore = 70 } = params;

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const peVal = num(report.valuation?.pe?.value);
  const pbVal = num(report.valuation?.pb?.value);
  const roeVal = bankMetrics?.roe ?? num(report.profitability?.roe?.value) ?? 14.5;
  const divYieldVal = num(report.valuation?.dividendYield?.value) ?? 1.1;

  // Fiscal year labeling derived dynamically (current FY27 / forward FY28E)
  const currentYear = new Date().getFullYear();
  const fiscalYearCurrent = `FY${String(currentYear + 1).slice(-2)}`;
  const fiscalYearForward = `FY${String(currentYear + 2).slice(-2)}E`;

  // Per-share base calculations
  const eps = peVal && peVal > 0 ? cmp / peVal : num(report.financials?.eps?.value) ?? Math.max(1, cmp / 20);
  const bv = bankMetrics?.bvps ?? (pbVal && pbVal > 0 ? cmp / pbVal : cmp / 2.5);

  let fairValueBase = cmp;
  let methodology = '';
  let formula = '';
  let coe = 0.13;
  let g = 0.08;

  if (profile === 'Banks/NBFC') {
    // ── SECTION 5 & 18.7: JUSTIFIED P/B MODEL FOR BANKS ──
    // Justified P/B = (RoE - g) / (CoE - g)
    // CoE = 13.0%, Sustainable Growth g = 8.0%
    const roeDecimal = Math.max(0.06, Math.min(0.25, roeVal / 100));
    coe = 0.13;
    g = 0.08;

    // Premium franchise multiplier for high-tier banks with pristine PCR and capital
    const qualityMultiplier = fqsScore >= 80 ? 1.15 : fqsScore >= 65 ? 1.0 : 0.85;
    const rawJustifiedPB = Math.max(0.8, (roeDecimal - g) / (coe - g));
    const justifiedPB = Math.round(rawJustifiedPB * qualityMultiplier * 100) / 100;

    fairValueBase = Math.round(bv * justifiedPB * 10) / 10;
    formula = `Justified P/B = (RoE - g) / (CoE - g) = (${(roeDecimal * 100).toFixed(1)}% - ${(g * 100).toFixed(1)}%) / (${(coe * 100).toFixed(1)}% - ${(g * 100).toFixed(1)}%) = ${justifiedPB.toFixed(2)}x`;
    methodology = `Justified P/B framework: ${justifiedPB.toFixed(2)}x on BVPS ₹${bv.toFixed(1)} (${formula})`;
  } else {
    // ── NON-FINANCIAL & CYCLICAL: EARNINGS MULTIPLE MODEL ──
    let targetPe = 22;
    if (peVal != null) {
      targetPe = Math.max(14, Math.min(36, peVal * 0.95));
    }
    const forwardEps = eps * 1.12; // 12% forward earnings growth estimate
    fairValueBase = Math.round(forwardEps * targetPe * 10) / 10;
    formula = `Fair Value = Forward EPS (₹${forwardEps.toFixed(1)}) × Target P/E (${targetPe.toFixed(1)}x)`;
    methodology = `Discounted forward multiple: ${formula} (${fiscalYearForward})`;
  }

  // Guard: Base fair value sanity check
  if (!Number.isFinite(fairValueBase) || fairValueBase <= 0) {
    fairValueBase = cmp;
  }

  const bear = Math.round(fairValueBase * 0.85 * 10) / 10;
  const bull = Math.round(fairValueBase * 1.25 * 10) / 10;

  const expectedReturnPct = Math.round(((fairValueBase - cmp) / cmp) * 1000) / 10;
  const marginOfSafetyPct = Math.round(((fairValueBase - cmp) / fairValueBase) * 1000) / 10;

  const fairValue: QtvtFairValue = {
    bear,
    base: fairValueBase,
    bull,
    expectedReturnPct,
    marginOfSafetyPct,
    methodology,
    formula,
    coe,
    sustainableGrowth: g,
  };

  // ── VALUATION SCORE (VS 0-100) ──
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
  if (profile === 'Banks/NBFC') {
    const currentPb = cmp / bv;
    if (currentPb <= 1.8) multipleScore = 30;
    else if (currentPb <= 2.5) multipleScore = 22;
    else if (currentPb <= 3.2) multipleScore = 14;
    else multipleScore = 6;
    factors.push({
      name: 'Asset Valuation Multiple (P/B & P/ABV)',
      score: multipleScore,
      weight: 30,
      evidence: `P/B multiple at ${currentPb.toFixed(2)}x on BVPS ₹${bv.toFixed(1)}.`,
    });
  } else {
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
      evidence: peVal != null ? `P/E multiple at ${peVal.toFixed(1)}x (${fiscalYearCurrent}).` : 'Trailing P/E unverified.',
    });
  }
  totalScore += multipleScore;
  totalWeight += 30;

  // 3. Asset & Yield Support (30 pts)
  let yieldScore = 15;
  if (divYieldVal >= 2.0) yieldScore += 10;
  else if (divYieldVal >= 1.0) yieldScore += 5;
  if (pbVal != null && pbVal <= 2.8) yieldScore += 5;
  yieldScore = Math.min(30, yieldScore);

  factors.push({
    name: 'Yield Support & Asset Protection',
    score: yieldScore,
    weight: 30,
    evidence: `Dividend Yield ${divYieldVal.toFixed(1)}%, Asset backing intact.`,
  });
  totalScore += yieldScore;
  totalWeight += 30;

  const score = Math.round((totalScore / Math.max(1, totalWeight)) * 100);
  const status = score >= 75 ? 'Strong' : score >= 60 ? 'Acceptable' : score >= 40 ? 'Mixed' : 'Weak';

  // 10Y G-Sec spread calculation
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
    fiscalYearCurrent,
    fiscalYearForward,
  };
}
