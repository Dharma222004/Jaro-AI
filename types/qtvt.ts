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
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
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
  factors: Array<{ name: string; score: number; weight: number; evidence: string }>;
}

export interface QtvtTrendResult {
  score: number;
  rsScore: number;
  rsPercentile: number;
  rsLineStatus: 'outperforming' | 'in-line' | 'underperforming';
  regime: string;
  sma200Slope: 'rising' | 'flat' | 'falling';
  sma50vs200: 'above' | 'below' | 'cross';
  above30WeekMa: boolean;
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

export interface QtvtSizingPlan {
  risk_budget_pct: number;
  max_risk_amount: number;
  shares: number;
  position_value: number;
  portfolio_pct: number;
  caps_applied: string[];
  notes: string;
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
  gates: QtvtGate[];
  what_would_change_the_call: string[];
  events: QtvtEventItem[];
  meta: {
    strategy_id: 'QTVT-2.0.0';
    policy_id: string;
    release_status: 'shadow' | 'paper' | 'live';
    data_versions: Record<string, string>;
  };
}
