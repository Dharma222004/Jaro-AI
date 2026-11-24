export type QtvtVerdict = 'ACTIONABLE' | 'WAIT_FOR_ENTRY' | 'WATCHLIST' | 'AVOID' | 'DATA_ERROR';
export type QtvtHorizon = 'SWING' | 'POSITION';
export type QtvtSectorProfile = 'Banks/NBFC' | 'Non-financial' | 'Cyclical/Commodity' | 'Unsupported';
export type QtvtSetupState = 'NO_SETUP' | 'FORMING' | 'READY' | 'TRIGGERED' | 'EXTENDED';
export type QtvtGateStatus = 'PASS' | 'FAIL' | 'WAIT' | 'UNVERIFIED' | 'N/A';
export type QtvtDataConfidence = 'High' | 'Medium' | 'Low';

export interface QtvtGate {
  id: string;
  group: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8';
  name: string;
  type: 'hard' | 'soft';
  status: QtvtGateStatus;
  metric: string;
  threshold: string;
  reason: string;
}

export interface QtvtFqsFactor {
  name: string;
  score: number;
  weight: number;
  evidence: string;
  status: 'PASS' | 'FAIL' | 'UNVERIFIED' | 'N/A';
}

export interface QtvtFqsResult {
  score: number;
  maxScore: number;
  status: 'Strong' | 'Acceptable' | 'Mixed' | 'Weak';
  vetoApplied?: boolean;
  vetoReason?: string;
  factors: QtvtFqsFactor[];
  missingData: string[];
}

export interface QtvtFairValue {
  bear: number;
  base: number;
  bull: number;
  expectedReturnPct: number;
  marginOfSafetyPct: number;
  methodology: string;
  formula?: string;
  coe?: number;
  sustainableGrowth?: number;
}

export interface QtvtVsResult {
  score: number;
  maxScore: number;
  status: 'Strong' | 'Acceptable' | 'Mixed' | 'Weak';
  fairValue: QtvtFairValue;
  pePercentile?: number | null;
  pbPercentile?: number | null;
  forwardPeg?: number | null;
  fcfYieldPct?: number | null;
  gsecSpreadBps?: number | null;
  fiscalYearCurrent?: string;
  fiscalYearForward?: string;
  factors: Array<{ name: string; score: number; weight: number; evidence: string }>;
}

export interface QtvtTrendResult {
  score: number;
  rsScore: number;
  rsPercentile: number;
  rsLineStatus: 'outperforming' | 'in-line' | 'underperforming';
  rsVsNifty500Pct: number;
  rsVsBankNiftyPct?: number | null;
  regime: string;
  sma200Slope: 'rising' | 'flat' | 'falling';
  sma50vs200: 'above' | 'below' | 'cross';
  above30WeekMa: boolean;
  adx14?: number;
  volumeUpDownRatio?: number;
  deliveryPctOnUpDays?: number;
  liquidityAvgCr: number;
  liquidityStatus: 'sufficient' | 'limited' | 'insufficient';
}

export interface QtvtSetupPlan {
  type: 'Trend Pullback' | 'Base Breakout' | 'Staged Accumulation' | 'None';
  state: QtvtSetupState;
  entry_zone_low: number;
  entry_zone_high: number;
  trigger: number;
  chase_limit: number;
  alert_price: number;
  invalidate_before_entry: number;
  expiry_sessions: number;
  confluence_factors: string[];
}

export interface QtvtStopPlan {
  price: number;
  basis: string;
  distance_atr: number;
  distance_pct: number;
  trail_rule: string;
  time_stop: string;
}

export interface QtvtTargetPlan {
  id: string;
  label: string;
  price: number;
  basis: string;
  supported: boolean;
  r_net: number;
  portion: number;
  upside_pct: number;
}

export interface QtvtRrPlan {
  at_cmp: number;
  at_zone_mid: number;
  at_chase_limit: number;
  blended_net: number;
  required_min: number;
}

export interface QtvtTranchePlan {
  trancheNumber: number;
  allocationPct: number;
  condition: string;
  shares: number;
  capital: number;
}

export interface QtvtSizingPlan {
  risk_budget_pct: number;
  max_risk_amount: number;
  shares: number;
  position_value: number;
  portfolio_pct: number;
  caps_applied: string[];
  notes: string;
  tranches?: QtvtTranchePlan[];
}

export interface QtvtTradePlan {
  horizon: QtvtHorizon;
  setup: QtvtSetupPlan;
  stop: QtvtStopPlan;
  targets: QtvtTargetPlan[];
  rr: QtvtRrPlan;
  sizing: QtvtSizingPlan;
}

export interface QtvtEventItem {
  type: string;
  date: string;
  source: string;
  verified: boolean;
  estimated?: boolean;
  days_to_event?: number;
  impact: string;
}

export interface QtvtBankMetrics {
  nii?: number | null;
  ppop?: number | null;
  patStandalone?: number | null;
  patConsolidated?: number | null;
  nim?: number | null;
  gnpa?: number | null;
  nnpa?: number | null;
  pcr?: number | null;
  slippageRatio?: number | null;
  creditCostBps?: number | null;
  casaTotalPct?: number | null;
  casaRetailPct?: number | null;
  advancesGrowthYoY?: number | null;
  depositGrowthYoY?: number | null;
  creditDepositRatio?: number | null;
  crarPct?: number | null;
  cet1Pct?: number | null;
  lcrPct?: number | null;
  roa?: number | null;
  roe?: number | null;
  bvps?: number | null;
  adjustedBvps?: number | null;
  costToIncomePct?: number | null;
  treasuryGainsSharePct?: number | null;
  qualityOfProfitNote?: string;
}

export interface QtvtInvariants {
  marketCapMatch: boolean;
  peMatch: boolean;
  pbMatch: boolean;
  range52Match: boolean;
  levelsWithinBounds: boolean;
  externalTargetRatioOk: boolean;
  details: string[];
}

export interface QtvtComparability {
  hasCorporateEvent: boolean;
  eventType?: 'Merger' | 'Demerger' | 'Bonus' | 'Stock Split' | 'None';
  eventDetails?: string;
  isComparable: boolean;
  organicGrowthNote?: string;
}

export interface QtvtPeerComparisonRow {
  symbol: string;
  name: string;
  roa?: number | null;
  roe?: number | null;
  nim?: number | null;
  gnpa?: number | null;
  casa?: number | null;
  pb?: number | null;
  pe?: number | null;
}

export interface QtvtFlows {
  promoterHoldingPct: number;
  promoterTrend: string;
  pledgePct: number;
  pledgeTrend: string;
  fiiHoldingPct: number;
  fiiTrend: string;
  diiHoldingPct: number;
  diiTrend: string;
  publicHoldingPct: number;
  publicTrend: string;
  institutionalScore: number;
}

export interface QtvtResult {
  symbol: string;
  isin?: string;
  horizon: QtvtHorizon;
  as_of: string;
  cmp: number;
  atr: number;
  verdict: QtvtVerdict;
  verdict_reason: string;
  score: number; // 0-100 composite confluence
  data_confidence: QtvtDataConfidence;
  data_confidence_score: number; // %
  sector_profile: QtvtSectorProfile;
  fqs: QtvtFqsResult;
  vs: QtvtVsResult;
  trend: QtvtTrendResult;
  setup: QtvtSetupPlan;
  stop: QtvtStopPlan;
  targets: QtvtTargetPlan[];
  rr: QtvtRrPlan;
  sizing: QtvtSizingPlan;
  swingPlan: QtvtTradePlan;
  positionPlan: QtvtTradePlan;
  bankMetrics?: QtvtBankMetrics;
  invariants: QtvtInvariants;
  comparability: QtvtComparability;
  peerComparison?: QtvtPeerComparisonRow[];
  flows: QtvtFlows;
  gates: QtvtGate[];
  what_would_change_the_call: string[];
  events: QtvtEventItem[];
  dataQualityLog: {
    conflicts: string[];
    unverifiedItems: string[];
    adjustments: string[];
  };
  meta: {
    strategy_id: 'QTVT-2.0.0';
    policy_id: string;
    release_status: 'shadow' | 'paper' | 'live';
    data_versions: Record<string, string>;
  };
}
