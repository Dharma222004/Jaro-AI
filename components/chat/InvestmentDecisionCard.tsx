'use client';

import { useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Building2, Crosshair, Gauge, Scale, ShieldAlert, Target } from 'lucide-react';
import type { ExplainableScore, InvestmentDecisionResult } from '@/types/decision';
import { TechnicalChart } from './TechnicalChart';
import { JaroMark } from '@/components/brand/JaroLogo';

export function InvestmentDecisionCard({ result }: { result: InvestmentDecisionResult }) {
  const [horizonTab, setHorizonTab] = useState<'SWING' | 'POSITION'>('SWING');
  const range = result.week52.high - result.week52.low;
  const position = range > 0 ? Math.max(0, Math.min(100, (result.currentPrice - result.week52.low) / range * 100)) : 50;
  const strategy = result.systematic?.selected;

  const q = result.qtvt;
  const currentPlan = q ? (horizonTab === 'POSITION' ? q.positionPlan : q.swingPlan) : null;

  return (
    <div className="decision-artifact">
      {/* Top Header Card */}
      <div className="decision-topline">
        <div className="decision-summary-block">
          <div className="decision-identity">
            <JaroMark size={24} />
            <span>Jaro AI · {strategy ? `${strategy.strategyName} ${strategy.strategyVersion}` : 'Investment Decision Engine'}</span>
          </div>
          <div className="decision-company-header">
            <h1 className="decision-company-name">
              {result.company?.name || result.technical?.primary?.instrument?.name || result.company?.ticker || 'Equity Analysis'}
            </h1>
            <div className="decision-company-tags">
              <span className="decision-ticker-pill">
                {result.company?.exchange || result.technical?.primary?.instrument?.exchange || 'NSE'}:{' '}
                {result.company?.ticker || result.technical?.primary?.instrument?.trading_symbol}
              </span>
              {result.company?.sector && (
                <span className="decision-sector-pill">{result.company.sector}</span>
              )}
              {result.company?.isin && (
                <span className="decision-sector-pill">ISIN: {result.company.isin}</span>
              )}
            </div>
          </div>
          <div className="decision-badge-wrap">
            <span className={`decision-badge ${result.classification.toLowerCase()}`}>
              {statusLabel(result)}
            </span>
          </div>
          <h2 className="decision-title">{result.classificationLabel}</h2>
          <p className="decision-desc">{decisionExplanation(result)}</p>
          <small className="decision-compliance">{result.complianceLabel}</small>
        </div>

        <div className="decision-price-box">
          <span className={`market-data-state ${result.marketDataStatus}`}>
            {result.marketDataStatus.replaceAll('-', ' ')}
          </span>
          <strong className="decision-price-val">{money(result.currentPrice)}</strong>
          <span className="decision-price-time">
            {new Date(result.marketTimestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          <span className="decision-horizon-badge">{result.horizon} horizon</span>
        </div>
      </div>

      {/* Systematic Context Cards - 2x2 Clean Stack */}
      {result.systematic && (
        <div className="systematic-context-grid">
          <div className="systematic-card">
            <span className="systematic-label">Market Regime</span>
            <strong className="systematic-val">{result.systematic.marketRegime.classification.replaceAll('-', ' ')}</strong>
            <p className="systematic-desc">{result.systematic.marketRegime.reasoning[0]}</p>
          </div>
          <div className="systematic-card">
            <span className="systematic-label">Sector Strength</span>
            <strong className="systematic-val">{result.systematic.sectorStrength.classification}</strong>
            <p className="systematic-desc">{result.systematic.sectorStrength.reasoning[0]}</p>
          </div>
          <div className="systematic-card">
            <span className="systematic-label">Stock Relative Strength</span>
            <strong className="systematic-val">
              {result.systematic.stockStrength.relativeToNiftyPct == null
                ? 'Relative strength unavailable'
                : `${result.systematic.stockStrength.relativeToNiftyPct >= 0 ? '+' : ''}${result.systematic.stockStrength.relativeToNiftyPct}% vs NIFTY`}
            </strong>
            <p className="systematic-desc">Liquidity: {result.systematic.stockStrength.liquidity}</p>
          </div>
          <div className="systematic-card">
            <span className="systematic-label">Systematic Gate Result</span>
            <strong className="systematic-val">{strategy?.status.replaceAll('_', ' ') ?? 'No selected playbook'}</strong>
            <p className="systematic-desc">
              {strategy ? `${strategy.score ?? 'N/A'}/100 · ${strategy.scoreCoveragePct}% rule coverage` : 'No playbook had sufficient inputs.'}
            </p>
          </div>
        </div>
      )}

      {/* 4 Pillars Score Grid */}
      <div className="decision-score-grid-v2">
        <ScoreCard
          scoreObj={result.fundamentalScore}
          fallbackLabel="Fundamentals"
          fallbackDescription="Growth, returns, balance sheet leverage and cash generation"
          icon={Building2}
        />
        <ScoreCard
          scoreObj={result.valuationScore}
          fallbackLabel="Valuation"
          fallbackDescription="Available historical and relative valuation multiples"
          icon={Scale}
        />
        <ScoreCard
          scoreObj={result.technicalScore}
          fallbackLabel="Technical"
          fallbackDescription="Trend structure, moving averages, momentum and volume"
          icon={Activity}
        />
        <ScoreCard
          scoreObj={result.riskScore}
          fallbackLabel="Risk Resilience"
          fallbackDescription="Financial volatility, balance sheet risk and operational disclosure"
          icon={ShieldAlert}
        />
      </div>

      {/* 52-Week Range Slider */}
      <div className="week52-card">
        <div className="week52-endpoint">
          <span>52-Week Low</span>
          <strong>{money(result.week52.low)}</strong>
        </div>
        <div className="week52-range-wrap">
          <div className="week52-track">
            <span style={{ left: `${position}%` }} />
            <i style={{ width: `${position}%` }} />
          </div>
          <strong
            className="week52-current"
            style={{
              left: `${position}%`,
              transform: position < 12 ? 'none' : position > 88 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {money(result.currentPrice)}
          </strong>
          <small>Validated market price · {new Date(result.marketTimestamp).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</small>
        </div>
        <div className="week52-endpoint text-right">
          <span>52-Week High</span>
          <strong>{money(result.week52.high)}</strong>
        </div>
      </div>

      {/* Valuation Summary Strip (Bear, Base Fair Value, Bull) */}
      {q && q.vs?.fairValue && (
        <div className="valuation-summary-strip">
          <div className="valuation-summary-col">
            <span className="valuation-summary-label">Bear Scenario</span>
            <strong className="valuation-summary-val bear">₹{q.vs.fairValue.bear.toLocaleString('en-IN')}</strong>
            <small className="valuation-summary-note">Conservative multiple</small>
          </div>
          <div className="valuation-summary-col highlighted">
            <span className="valuation-summary-label">Base Fair Value ({q.vs.fiscalYearForward ?? 'FY27'})</span>
            <strong className="valuation-summary-val base">₹{q.vs.fairValue.base.toLocaleString('en-IN')}</strong>
            <span className={`valuation-safety-tag ${q.vs.fairValue.marginOfSafetyPct >= 0 ? 'positive' : 'negative'}`}>
              {q.vs.fairValue.marginOfSafetyPct >= 0 ? '+' : ''}{q.vs.fairValue.marginOfSafetyPct}% Margin of Safety
            </span>
          </div>
          <div className="valuation-summary-col">
            <span className="valuation-summary-label">Bull Scenario</span>
            <strong className="valuation-summary-val bull">₹{q.vs.fairValue.bull.toLocaleString('en-IN')}</strong>
            <small className="valuation-summary-note">Franchise expansion</small>
          </div>
        </div>
      )}

      {/* Interactive Technical Chart Canvas */}
      {result.technical?.primary && (
        <TechnicalChart
          initial={result.technical.primary}
          companyName={result.company?.name}
        />
      )}

      {/* Entry, Targets & Risk Scenarios */}
      <div className="decision-levels-heading">
        <div>
          <h3>Entry, Targets and Risk Levels</h3>
          <span>Conditional analytical scenarios based on verified chart structure</span>
        </div>
        {q && (
          <div className="horizon-toggle-row">
            <button
              type="button"
              className={`horizon-btn ${horizonTab === 'SWING' ? 'active' : ''}`}
              onClick={() => setHorizonTab('SWING')}
            >
              SWING (3–40d)
            </button>
            <button
              type="button"
              className={`horizon-btn ${horizonTab === 'POSITION' ? 'active' : ''}`}
              onClick={() => setHorizonTab('POSITION')}
            >
              POSITION (6–36m)
            </button>
          </div>
        )}
      </div>

      <div className="decision-levels-grid">
        {/* Preferred Entry */}
        <div className="decision-level-card entry">
          <div className="level-card-header">
            <div className="level-card-icon entry"><Crosshair size={18} /></div>
            <span className="level-card-badge">{currentPlan ? `${currentPlan.setup.type} (${currentPlan.setup.state})` : (strategy?.entry?.zoneLabel ?? 'Entry Setup')}</span>
          </div>
          <span className="level-card-title">Preferred Entry Range</span>
          <strong className="level-card-price">
            {currentPlan
              ? `${money(currentPlan.setup.entry_zone_low)} – ${money(currentPlan.setup.entry_zone_high)}`
              : result.preferredEntry ? `${money(result.preferredEntry.rangeLow)} – ${money(result.preferredEntry.rangeHigh)}` : 'Wait for confirmation'}
          </strong>
          <p className="level-card-sub">
            {currentPlan
              ? `Alert: ${money(currentPlan.setup.alert_price)} · Chase Limit: ${money(currentPlan.setup.chase_limit)} · Trigger: ${money(currentPlan.setup.trigger)}`
              : strategy?.entry
                ? `Trigger: ${money(strategy.entry.triggerPrice)} · Max: ${money(strategy.entry.maximumEntryPrice)}`
                : result.preferredEntry
                  ? `${result.preferredEntry.type} · ${result.preferredEntry.status.replaceAll('-', ' ')}`
                  : 'No active entry setup'}
          </p>
        </div>

        {/* Targets */}
        {(currentPlan?.targets?.length ? currentPlan.targets : (result.qtvt?.targets?.length ? result.qtvt.targets : result.targets)).map((target, idx) => {
          const isQtvtTarget = 'r_net' in target;
          const targetPrice = target.price;
          const targetUpside = isQtvtTarget ? target.upside_pct : (target as any).upsidePct;
          const targetRr = isQtvtTarget ? target.r_net : (target as any).riskReward;
          const targetPortion = isQtvtTarget ? `Book ${Math.round(target.portion * 100)}% · ` : '';

          return (
            <div className="decision-level-card target" key={target.label ?? idx}>
              <div className="level-card-header">
                <div className="level-card-icon target"><Target size={18} /></div>
                <span className="level-card-badge green">Target {idx + 1}</span>
              </div>
              <span className="level-card-title">{target.label}</span>
              <strong className="level-card-price green">{money(targetPrice)}</strong>
              <p className="level-card-sub">
                <span className="text-positive font-bold">+{targetUpside.toFixed(1)}% upside</span>
                {targetRr != null && <span> · {targetPortion}{targetRr}:1 Net R</span>}
              </p>
            </div>
          );
        })}

        {/* Risk / Stop-Loss */}
        <div className="decision-level-card stop">
          <div className="level-card-header">
            <div className="level-card-icon stop"><ShieldAlert size={18} /></div>
            <span className="level-card-badge red">Stop-Loss Invalidation</span>
          </div>
          <span className="level-card-title">Risk Level</span>
          <strong className="level-card-price red">
            {currentPlan ? money(currentPlan.stop.price) : result.stopLoss ? money(result.stopLoss.price) : 'N/A'}
          </strong>
          <p className="level-card-sub">
            {currentPlan
              ? `${currentPlan.stop.distance_atr} ATR · −${currentPlan.stop.distance_pct.toFixed(1)}% risk (${currentPlan.stop.basis})`
              : result.stopLoss
                ? `${money(result.stopLoss.riskPerShare)}/share · −${result.stopLoss.downsidePct.toFixed(1)}% risk`
                : 'Insufficient price structure'}
          </p>
        </div>
      </div>

      {/* Empty Setup Notice */}
      {!result.preferredEntry && !currentPlan && (
        <div className="decision-empty-setup">
          <Crosshair size={20} />
          <div>
            <strong>Wait for Confirmation</strong>
            <span>Current price structure does not present a validated entry setup. Wait for price consolidation or breakout confirmation.</span>
          </div>
        </div>
      )}

      {/* Position Sizing */}
      {(currentPlan?.sizing || result.qtvt?.sizing || result.positionSizing) && (
        <div className="position-sizing-strip">
          <div className="sizing-icon"><Gauge size={20} /></div>
          <div className="sizing-content">
            <div className="sizing-top">
              <span>{currentPlan ? `${horizonTab} Position Sizing (${currentPlan.sizing.risk_budget_pct}% budget)` : result.qtvt ? `Risk-Budgeted Position Sizing (${result.qtvt.sizing.risk_budget_pct}% budget)` : result.positionSizing?.blocked ? 'Sizing Blocked by Policy' : 'Systematic Position Sizing'}</span>
              <strong>{currentPlan ? `${currentPlan.sizing.shares} Shares` : result.qtvt ? `${result.qtvt.sizing.shares} Shares` : `${result.positionSizing?.quantity ?? 0} Shares`}</strong>
            </div>
            <small>
              {currentPlan
                ? `Position Value: ${money(currentPlan.sizing.position_value)} (${currentPlan.sizing.portfolio_pct}% portfolio) · Net R/R: ${currentPlan.rr.at_cmp}:1 at CMP (${currentPlan.rr.blended_net}:1 blended) · ${currentPlan.sizing.notes}`
                : result.qtvt
                ? `Position Value: ${money(result.qtvt.sizing.position_value)} (${result.qtvt.sizing.portfolio_pct}% portfolio) · Planned Risk: ${money(result.qtvt.sizing.max_risk_amount)} · ${result.qtvt.sizing.notes}`
                : result.positionSizing?.blocked
                  ? result.positionSizing.blockedReasons.join(' ')
                  : `${money(result.positionSizing?.estimatedMaximumPlannedLoss ?? 0)} planned loss · ${money(result.positionSizing?.estimatedExecutionCosts ?? 0)} estimated costs`}
            </small>
          </div>
        </div>
      )}

      {/* What Would Make This Actionable Banner (Section 15) */}
      {q && q.what_would_change_the_call.length > 0 && (
        <div className="actionable-change-banner">
          <strong>What would make this actionable:</strong>
          <span>{q.what_would_change_the_call[0]}</span>
        </div>
      )}

      {/* Regulatory Disclosure */}
      <div className="decision-disclosure">
        <AlertTriangle size={15} />
        <span>Decision-support research scenario—not personalized investment advice or an instruction to transact. Confirm regulatory compliance requirements before making financial decisions.</span>
      </div>

      {/* QTVT Confluence Gates Accordion (L0 to L8) */}
      {result.qtvt && (
        <details className="strategy-methodology">
          <summary>JARO Method v2 — QTVT Confluence Gate Audit ({result.qtvt.gates.length} Gates)</summary>
          <div className="methodology-body">
            <div className="qtvt-summary-row">
              <span className={`qtvt-verdict-pill ${result.qtvt.verdict.toLowerCase()}`}>
                {result.qtvt.verdict.replaceAll('_', ' ')}
              </span>
              <span className="qtvt-score-pill">Confluence Score: {result.qtvt.score}/100</span>
              <span className="qtvt-confidence-pill">Data Confidence: {result.qtvt.data_confidence} ({result.qtvt.data_confidence_score}%)</span>
              <span className="qtvt-profile-pill">Sector: {result.qtvt.sector_profile}</span>
            </div>
            <p className="qtvt-verdict-desc"><strong>Verdict Call:</strong> {result.qtvt.verdict_reason}</p>
            
            {/* Grouped Gates by Level */}
            <div className="gates-list">
              {result.qtvt.gates.map((gate) => (
                <div key={gate.id} className="gate-row">
                  <span className={`gate-state ${gate.status.toLowerCase()}`}>{gate.status}</span>
                  <div>
                    <strong>[{gate.group}] {gate.name}:</strong> <em>{gate.metric}</em> ({gate.threshold}) — {gate.reason}
                  </div>
                </div>
              ))}
            </div>
            {result.qtvt.what_would_change_the_call.length > 0 && (
              <div className="qtvt-changes-box">
                <strong>What would change this call:</strong>
                <ul>
                  {result.qtvt.what_would_change_the_call.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="audit-hash">
              Strategy: <span className="font-mono">{result.qtvt.meta.strategy_id}</span> · Policy: <span className="font-mono">{result.qtvt.meta.policy_id}</span> · Release: <span className="font-mono">{result.qtvt.meta.release_status}</span> · Feed: <span className="font-mono">{result.qtvt.meta.data_versions.feed}</span>
            </p>
          </div>
        </details>
      )}

      {/* Strategy Methodology Accordion */}
      {strategy && (
        <details className="strategy-methodology">
          <summary>Strategy Methodology & Mandatory Gates ({strategy.gates.length})</summary>
          <div className="methodology-body">
            <p className="methodology-title"><strong>{strategy.strategyName} · {strategy.strategyVersion}</strong></p>
            <div className="gates-list">
              {strategy.gates.map((gate) => (
                <div key={gate.id} className="gate-row">
                  <span className={`gate-state ${gate.status}`}>{gate.status}</span>
                  <div>
                    <strong>{gate.label}:</strong> {gate.reason}
                  </div>
                </div>
              ))}
            </div>
            {strategy.methodology.map((item) => <p key={item} className="methodology-rule">• {item}</p>)}
            {strategy.costs && (
              <p className="methodology-costs">
                Cost assumptions: {strategy.costs.estimatedRoundTripCost} bps round trip, including {strategy.costs.slippageBpsPerSide} bps slippage per side.
              </p>
            )}
            <p className="audit-hash">
              Audit input hash: <span className="font-mono">{strategy.audit.inputsHash}</span> · {strategy.audit.candleCount} candles through {strategy.audit.lastCandleAt ?? 'unavailable'}.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

function ScoreCard({
  scoreObj,
  fallbackLabel,
  fallbackDescription,
  icon: Icon,
}: {
  scoreObj: ExplainableScore;
  fallbackLabel: string;
  fallbackDescription: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const score = scoreObj?.score;
  const coverage = scoreObj?.coveragePct ?? 0;
  const status = scoreObj?.status ?? scoreObj?.label ?? (score == null ? 'Insufficient data' : score >= 75 ? 'Strong' : score >= 60 ? 'Acceptable' : score >= 40 ? 'Mixed' : 'Weak');
  const label = scoreObj?.category || fallbackLabel;
  const description = scoreObj?.summary || fallbackDescription;
  const explanation = scoreObj?.explanation;
  const metrics = scoreObj?.supportingMetrics?.length
    ? scoreObj.supportingMetrics
    : (scoreObj?.factors?.map((f) => ({
        name: f.name,
        value: f.evidence,
        status: f.score != null ? ('verified' as const) : ('unavailable' as const),
      })) ?? []);
  const missing = scoreObj?.missingData ?? [];

  const isInsufficient = score == null || coverage < 25;
  const isPartial = !isInsufficient && coverage < 70;
  const value = score ?? 0;

  const statusClass = isInsufficient
    ? 'status-insufficient'
    : status === 'Strong'
    ? 'status-strong'
    : status === 'Acceptable'
    ? 'status-acceptable'
    : status === 'Mixed'
    ? 'status-mixed'
    : 'status-weak';

  return (
    <div className={`score-card-v2 ${isInsufficient ? 'is-insufficient' : ''}`}>
      {/* 1. Header Row: Icon + Category Name + Status Badge on Left, Score on Right */}
      <div className="score-card-v2-header">
        <div className="score-card-v2-title-wrap">
          <span className="score-card-v2-icon" aria-hidden="true">
            <Icon size={15} />
          </span>
          <span className="score-card-v2-label">{label}</span>
          <span className={`score-status-pill ${statusClass}`}>{status}</span>
        </div>
        <div className="score-card-v2-val-wrap">
          <span className="score-card-v2-val">
            {score == null ? 'N/A' : `${score}/100`}
          </span>
        </div>
      </div>

      {/* 2. Progress Bar: proportioned, visual representation of score */}
      <div className="score-card-v2-progress-track">
        <div
          className={`score-card-v2-progress-fill ${statusClass}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>

      {/* 3. Description & Short Explanation */}
      <p className="score-card-v2-desc">{description}</p>

      {/* 4. Supporting Evidence / Metrics Chips */}
      {metrics.length > 0 && (
        <div className="score-card-v2-metrics">
          {metrics.slice(0, expanded ? metrics.length : 4).map((m, idx) => (
            <div
              key={idx}
              className={`score-metric-chip ${m.status === 'unavailable' ? 'chip-unavailable' : ''}`}
            >
              <span className="metric-chip-name">{m.name}:</span>
              <span className="metric-chip-val">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* 5. Deep Explanation & Missing Data (when expanded) */}
      {expanded && explanation && (
        <div className="score-card-v2-deep-explanation">
          <p className="score-card-v2-rationale">{explanation}</p>
          {missing.length > 0 && (
            <div className="score-missing-data-note">
              <span className="missing-data-title">Missing inputs:</span>{' '}
              {missing.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* 6. Footer: Data Coverage on Left, Details Toggle on Right */}
      <div className="score-card-v2-footer">
        <span className={`score-coverage-pill-v2 ${isPartial ? 'limited' : ''}`}>
          {coverage}% DATA COVERAGE{isPartial ? ' · LIMITED' : ''}
        </span>
        {(metrics.length > 4 || explanation) && (
          <button
            type="button"
            className="score-card-v2-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show Less' : 'View Details'}
          </button>
        )}
      </div>
    </div>
  );
}

function statusLabel(result: InvestmentDecisionResult) {
  if (result.qtvt) {
    return result.qtvt.verdict.replaceAll('_', ' ');
  }
  const systematic = result.systematic?.selected?.status;
  if (systematic === 'ENTRY_AVAILABLE' && result.systematic?.selected?.releaseStatus !== 'validated') return 'SHADOW SETUP — NOT PUBLICLY RELEASED';
  if (systematic === 'ENTRY_AVAILABLE') return 'SETUP VALIDATED — ENTRY AVAILABLE';
  if (systematic === 'WAIT_FOR_CONFIRMATION') return 'WAIT FOR CONFIRMATION';
  if (systematic === 'WAIT_FOR_PULLBACK') return 'WAIT FOR PULLBACK';
  if (systematic === 'BREAKOUT_NOT_CONFIRMED') return 'BREAKOUT NOT CONFIRMED';
  if (systematic === 'PRICE_EXTENDED_DO_NOT_CHASE') return 'PRICE EXTENDED — DO NOT CHASE';
  if (systematic === 'SETUP_INVALIDATED') return 'SETUP INVALIDATED';
  if (systematic === 'INSUFFICIENT_MARKET_DATA') return 'INSUFFICIENT DATA';
  if (result.classification === 'BUY_SETUP') return 'BUY SETUP AVAILABLE';
  if (result.classification === 'WAIT') return 'WAIT';
  if (result.classification === 'HOLD_THESIS' || result.classification === 'GENERAL_ASSESSMENT') return 'WATCH';
  if (result.classification === 'EXIT_REVIEW' || result.classification === 'REDUCE_REVIEW') return 'NO VALIDATED SETUP';
  return 'INSUFFICIENT DATA';
}

function decisionExplanation(result: InvestmentDecisionResult) {
  const strategy = result.systematic?.selected;
  if (strategy) {
    if (strategy.status === 'ENTRY_AVAILABLE' && strategy.releaseStatus !== 'validated') {
      return `${strategy.strategyName} met its price-pattern rules but remains ${strategy.releaseStatus}-only. It is not an eligible public trade scenario.`;
    }
    if (strategy.status === 'ENTRY_AVAILABLE') {
      return `${strategy.strategyName} passed every mandatory trade gate. Entry remains conditional on the documented trigger and maximum acceptable price.`;
    }
    return `${strategy.strategyName} returned ${strategy.status.toLowerCase().replaceAll('_', ' ')}. Failed or pending mandatory gates prevent an eligible trade.`;
  }
  if (result.classification === 'BUY_SETUP') return 'A conditional setup is available only within the stated entry range and confirmation rules.';
  if (result.preferredEntry) return `Monitor the ${result.preferredEntry.type} scenario; the setup remains ${result.preferredEntry.status.replaceAll('-', ' ')}.`;
  return 'No validated entry setup is active. Wait for stronger price, volume and fundamental confirmation.';
}

function money(value: number) {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
