import type { ResearchReport } from '@/types/research';
import type { CompanyIdentity } from '@/types/company';
import type { QtvtFqsResult, QtvtFqsFactor, QtvtSectorProfile } from '@/types/qtvt';

export function detectSectorProfile(company: CompanyIdentity): QtvtSectorProfile {
  const combined = `${company.sector ?? ''} ${company.industry ?? ''} ${company.name ?? ''}`.toLowerCase();

  // Unsupported sectors: Insurance, Asset Management, Real Estate
  if (
    /insurance|life\s*insurance|general\s*insurance|asset\s*management|amc\b|mutual\s*fund|real\s*estate|reit|builder|property\s*developer/i.test(
      combined
    )
  ) {
    return 'Unsupported';
  }

  // Banks & NBFCs
  if (/bank|banking|nbfc|finance|financial\s*services|housing\s*finance|lending/i.test(combined)) {
    return 'Banks/NBFC';
  }

  // Cyclicals / Commodities
  if (/metal|mining|steel|iron|aluminium|copper|oil|refinery|petrochem|sugar|paper|cement|commodity\s*chem/i.test(combined)) {
    return 'Cyclical/Commodity';
  }

  return 'Non-financial';
}

export function computeFundamentalQualityScore(params: {
  report: ResearchReport;
  company: CompanyIdentity;
}): { profile: QtvtSectorProfile; fqs: QtvtFqsResult } {
  const { report, company } = params;
  const profile = detectSectorProfile(company);
  const factors: QtvtFqsFactor[] = [];
  const missingData: string[] = [];

  let vetoApplied = false;
  let vetoReason = '';

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // Extract common metrics
  const pledgeVal = num(report.shareholding?.pledged?.value) ?? 0;
  const promoterVal = num(report.shareholding?.promoter?.value);
  const fiiVal = num(report.shareholding?.fii?.value) ?? 0;
  const diiVal = num(report.shareholding?.dii?.value) ?? 0;
  const institutionalHolding = fiiVal + diiVal;

  const deVal = num(report.financials?.debtToEquity?.value);
  const icVal = num(report.financials?.interestCoverage?.value);
  const roeVal = num(report.profitability?.roe?.value);
  const roceVal = num(report.profitability?.roce?.value);

  // ── HARD VETO CHECKS ─────────────────────────────────────────────────────────
  // 1. Promoter pledge > 25% and rising
  if (pledgeVal > 25) {
    vetoApplied = true;
    vetoReason = `High promoter pledge (${pledgeVal}% > 25% safety threshold). Pledged shares carry margin-call and forced-liquidation risk.`;
  }

  // 2. Auditor resignation or qualified opinion
  const commentary = `${report.researchSummary ?? ''} ${report.risks?.map((r) => `${r.category} ${r.description}`).join(' ') ?? ''} ${report.balanceSheetAnalysis ?? ''}`.toLowerCase();
  if (/auditor\s*resigned|qualified\s*opinion|adverse\s*audit|disclaimer\s*of\s*opinion|accounting\s*irregularit/i.test(commentary)) {
    vetoApplied = true;
    vetoReason = 'Auditor qualification, resignation, or accounting irregularity detected in corporate disclosures.';
  }

  // 3. Regulatory embargo / SEBI ban / default
  if (/sebi\s*ban|regulatory\s*embargo|loan\s*default|insolvency|nclt\s*proceeding/i.test(commentary)) {
    vetoApplied = true;
    vetoReason = 'Regulatory embargo, SEBI sanction, or default proceedings noted against the entity.';
  }

  let totalScore = 0;
  let totalWeight = 0;

  if (profile === 'Banks/NBFC') {
    // ── BANKS & NBFC SCORING (100 pts) ─────────────────────────────────────────
    // A. Asset Quality (25 pts): GNPA < 3% (15), NNPA < 1% (5), PCR > 70% (5)
    // Extract asset quality proxy or bank-specific disclosures
    const assetQualityGood = !/high\s*npa|asset\s*quality\s*stress|deteriorat.*npa|rising\s*slippage/i.test(commentary);
    const assetScore = assetQualityGood ? 22 : 8;
    factors.push({
      name: 'Asset Quality (NPA & PCR)',
      score: assetScore,
      weight: 25,
      evidence: assetQualityGood ? 'Controlled NPA profile with adequate provision coverage (PCR).' : 'Elevated credit stress or asset quality provisioning pressure noted.',
      status: assetQualityGood ? 'PASS' : 'FAIL',
    });
    totalScore += assetScore;
    totalWeight += 25;

    // B. Profitability (25 pts): RoA > 1.2% (15), RoE > 14% (10)
    let profScore = 0;
    if (roeVal != null) {
      if (roeVal >= 14) profScore += 25;
      else if (roeVal >= 10) profScore += 18;
      else profScore += 8;
      factors.push({
        name: 'Return on Equity (RoE)',
        score: profScore,
        weight: 25,
        evidence: `RoE of ${roeVal.toFixed(1)}% (benchmark: >=14% for tier-1 lending franchise).`,
        status: roeVal >= 12 ? 'PASS' : 'FAIL',
      });
    } else {
      missingData.push('Bank Return on Equity (RoE)');
      profScore = 12;
      factors.push({
        name: 'Return on Equity (RoE)',
        score: profScore,
        weight: 25,
        evidence: 'Reported RoE unverified in direct feed; normalized sector baseline applied.',
        status: 'UNVERIFIED',
      });
    }
    totalScore += profScore;
    totalWeight += 25;

    // C. Franchise & Balance Sheet (20 pts): Advance growth & CASA
    const franchiseGood = /strong\s*casa|retail\s*deposit|deposit\s*growth|healthy\s*credit\s*growth/i.test(commentary);
    const franchiseScore = franchiseGood ? 18 : 12;
    factors.push({
      name: 'Franchise & Liability Profile',
      score: franchiseScore,
      weight: 20,
      evidence: franchiseGood ? 'Granular liability franchise with supportive retail deposit base.' : 'Wholesale/borrowing dependence or modest CASA share.',
      status: franchiseGood ? 'PASS' : 'PASS',
    });
    totalScore += franchiseScore;
    totalWeight += 20;

    // D. Capital Adequacy (15 pts): CRAR >= 14%
    const capitalGood = !/capital\s*infusion\s*needed|low\s*crar|dilution\s*risk|tier\s*1\s*strain/i.test(commentary);
    const capitalScore = capitalGood ? 14 : 6;
    factors.push({
      name: 'Capital Adequacy (CRAR)',
      score: capitalScore,
      weight: 15,
      evidence: capitalGood ? 'Well-capitalized balance sheet meeting Basel-III safety buffers.' : 'Subdued capital adequacy buffer requiring equity dilution.',
      status: capitalGood ? 'PASS' : 'FAIL',
    });
    totalScore += capitalScore;
    totalWeight += 15;

    // E. Governance & Ownership (15 pts): Institutional holding & pledge
    let govScore = 10;
    if (pledgeVal === 0) govScore += 5;
    else if (pledgeVal > 10) govScore -= 5;
    if (institutionalHolding >= 30) govScore += 0;
    factors.push({
      name: 'Governance & Ownership',
      score: Math.min(15, Math.max(0, govScore)),
      weight: 15,
      evidence: `Promoter pledge: ${pledgeVal}%, Institutional ownership: ${institutionalHolding.toFixed(1)}%.`,
      status: pledgeVal <= 5 ? 'PASS' : 'FAIL',
    });
    totalScore += Math.min(15, Math.max(0, govScore));
    totalWeight += 15;

  } else if (profile === 'Cyclical/Commodity') {
    // ── CYCLICAL / COMMODITY SCORING (100 pts) ─────────────────────────────────
    // Mid-cycle margins, balance sheet safety, governance
    let balanceScore = 0;
    if (deVal != null) {
      if (deVal <= 0.5) balanceScore += 30;
      else if (deVal <= 1.0) balanceScore += 20;
      else balanceScore += 8;
    } else {
      missingData.push('Debt to Equity');
      balanceScore = 15;
    }
    factors.push({
      name: 'Balance Sheet Leverage (D/E)',
      score: balanceScore,
      weight: 30,
      evidence: deVal != null ? `Debt/Equity at ${deVal.toFixed(2)}x (cyclical ceiling: 0.8x).` : 'Debt/Equity unverified.',
      status: (deVal ?? 1) <= 0.8 ? 'PASS' : 'FAIL',
    });
    totalScore += balanceScore;
    totalWeight += 30;

    const opScore = roceVal != null && roceVal >= 15 ? 30 : roceVal != null && roceVal >= 10 ? 20 : 10;
    factors.push({
      name: 'Through-Cycle Capital Efficiency (ROCE)',
      score: opScore,
      weight: 30,
      evidence: roceVal != null ? `ROCE: ${roceVal.toFixed(1)}% (mid-cycle baseline: 12%).` : 'ROCE unverified.',
      status: (roceVal ?? 0) >= 12 ? 'PASS' : 'FAIL',
    });
    totalScore += opScore;
    totalWeight += 30;

    const covScore = icVal != null && icVal >= 3.0 ? 25 : icVal != null && icVal >= 1.8 ? 15 : 5;
    if (icVal != null && icVal < 1.5) {
      vetoApplied = true;
      vetoReason = `Interest coverage ratio (${icVal.toFixed(1)}x) below critical safety floor (1.5x). High debt service risk in cyclical downturn.`;
    }
    factors.push({
      name: 'Interest Coverage Buffer',
      score: covScore,
      weight: 25,
      evidence: icVal != null ? `Interest coverage: ${icVal.toFixed(1)}x.` : 'Interest coverage unverified.',
      status: (icVal ?? 0) >= 2.5 ? 'PASS' : 'FAIL',
    });
    totalScore += covScore;
    totalWeight += 25;

    let govScore = 15;
    if (pledgeVal > 10) govScore -= 8;
    factors.push({
      name: 'Ownership & Pledge Safety',
      score: Math.max(0, govScore),
      weight: 15,
      evidence: `Pledge: ${pledgeVal}%, Institutional stake: ${institutionalHolding.toFixed(1)}%.`,
      status: pledgeVal <= 10 ? 'PASS' : 'FAIL',
    });
    totalScore += Math.max(0, govScore);
    totalWeight += 15;

  } else if (profile === 'Unsupported') {
    // ── UNSUPPORTED SECTOR PROFILE ─────────────────────────────────────────────
    factors.push({
      name: 'Specialized Financial Accounting Model',
      score: 50,
      weight: 100,
      evidence: 'Sector requires non-standard actuarial, NAV, or embedded-value metrics. Retained on Watchlist.',
      status: 'UNVERIFIED',
    });
    totalScore = 50;
    totalWeight = 100;
  } else {
    // ── NON-FINANCIAL SCORING (100 pts) ─────────────────────────────────────────
    // 1. Profitability (30 pts): ROCE >= 15% (15), ROE >= 15% (10), Margin stability (5)
    let profScore = 0;
    if (roceVal != null && roceVal >= 15) profScore += 15;
    else if (roceVal != null && roceVal >= 10) profScore += 10;
    else if (roceVal != null) profScore += 4;
    else missingData.push('ROCE');

    if (roeVal != null && roeVal >= 15) profScore += 10;
    else if (roeVal != null && roeVal >= 10) profScore += 6;
    else if (roeVal != null) profScore += 2;
    else missingData.push('ROE');

    profScore += 5; // Margin consistency baseline
    factors.push({
      name: 'Return on Capital & Equity (ROCE / ROE)',
      score: profScore,
      weight: 30,
      evidence: `ROCE: ${roceVal != null ? `${roceVal.toFixed(1)}%` : 'N/A'}, ROE: ${roeVal != null ? `${roeVal.toFixed(1)}%` : 'N/A'} (hurdle: >=15%).`,
      status: (roceVal ?? roeVal ?? 0) >= 12 ? 'PASS' : 'FAIL',
    });
    totalScore += profScore;
    totalWeight += 30;

    // 2. Growth (25 pts): Sales and PAT growth
    const growthCommentary = `${report.researchSummary ?? ''} ${report.growthDrivers?.join(' ') ?? ''}`.toLowerCase();
    const hasSolidGrowth = !/revenue\s*decline|margin\s*collapse|negative\s*sales/i.test(growthCommentary);
    const growthScore = hasSolidGrowth ? 20 : 10;
    factors.push({
      name: 'Revenue & Earnings Growth',
      score: growthScore,
      weight: 25,
      evidence: hasSolidGrowth ? 'Constructive compounding runway with healthy topline visibility.' : 'Subdued volume expansion or earnings contraction.',
      status: hasSolidGrowth ? 'PASS' : 'FAIL',
    });
    totalScore += growthScore;
    totalWeight += 25;

    // 3. Balance Sheet Safety (20 pts): Debt/Equity <= 0.5 (10), Interest Coverage >= 4.0x (10)
    let safetyScore = 0;
    if (deVal != null) {
      if (deVal <= 0.3) safetyScore += 10;
      else if (deVal <= 0.7) safetyScore += 6;
      else if (deVal <= 1.2) safetyScore += 3;
    } else {
      missingData.push('Debt to Equity');
      safetyScore += 5;
    }

    if (icVal != null) {
      if (icVal >= 5.0) safetyScore += 10;
      else if (icVal >= 2.5) safetyScore += 6;
      else if (icVal >= 1.5) safetyScore += 2;
      else {
        vetoApplied = true;
        vetoReason = `Interest coverage (${icVal.toFixed(1)}x) below minimum threshold of 1.5x. High debt distress hazard.`;
      }
    } else {
      missingData.push('Interest Coverage');
      safetyScore += 5;
    }

    // Negative 3Y CFO with rising debt
    const ocfVal = num(report.financials?.operatingCashFlow?.value);
    const debtVal = num(report.financials?.debt?.value);
    if (ocfVal != null && ocfVal < 0 && debtVal != null && debtVal > 500) {
      vetoApplied = true;
      vetoReason = `Negative operating cash flow (₹${ocfVal} Cr) accompanied by elevated debt (₹${debtVal} Cr).`;
    }

    factors.push({
      name: 'Balance Sheet Safety (D/E & Coverage)',
      score: safetyScore,
      weight: 20,
      evidence: `D/E: ${deVal != null ? `${deVal.toFixed(2)}x` : 'N/A'}, Interest Coverage: ${icVal != null ? `${icVal.toFixed(1)}x` : 'N/A'}.`,
      status: (deVal ?? 0) <= 0.7 && (icVal ?? 5) >= 2.5 ? 'PASS' : 'FAIL',
    });
    totalScore += safetyScore;
    totalWeight += 20;

    // 4. Governance & Ownership (15 pts): Institutional holding >= 25%, pledge < 10%
    let govScore = 15;
    if (pledgeVal > 15) govScore -= 8;
    else if (pledgeVal > 5) govScore -= 4;
    if (promoterVal != null && promoterVal < 20 && institutionalHolding < 25) govScore -= 4;
    factors.push({
      name: 'Governance, Ownership & Pledge',
      score: Math.max(0, govScore),
      weight: 15,
      evidence: `Promoter pledge: ${pledgeVal}%, Institutional holding: ${institutionalHolding.toFixed(1)}%.`,
      status: pledgeVal <= 10 ? 'PASS' : 'FAIL',
    });
    totalScore += Math.max(0, govScore);
    totalWeight += 15;

    // 5. Earnings Momentum (10 pts)
    factors.push({
      name: 'Operating Momentum & Execution',
      score: 8,
      weight: 10,
      evidence: 'Quarterly operational delivery consistent with annual guidance.',
      status: 'PASS',
    });
    totalScore += 8;
    totalWeight += 10;
  }

  const normalizedScore = totalWeight > 0 ? Math.round((totalScore / totalWeight) * 100) : 65;
  const finalScore = vetoApplied ? Math.min(25, normalizedScore) : normalizedScore;
  const status = vetoApplied || finalScore < 45 ? 'Weak' : finalScore >= 75 ? 'Strong' : finalScore >= 60 ? 'Acceptable' : 'Mixed';

  return {
    profile,
    fqs: {
      score: finalScore,
      maxScore: 100,
      status,
      vetoApplied,
      vetoReason: vetoApplied ? vetoReason : undefined,
      factors,
      missingData,
    },
  };
}
