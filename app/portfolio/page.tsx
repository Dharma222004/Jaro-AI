'use client';

import { useCallback, useState, useMemo } from 'react';
import { Plus, Trash2, Activity, BarChart3, PieChart, ShieldAlert } from 'lucide-react';
import type { PortfolioRiskBudget } from '@/types/portfolio';

interface PositionRow {
  instrumentKey: string;
  ticker: string;
  exchange: string;
  sector: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  target?: number;
}

interface OptimizedPosition {
  instrumentKey: string;
  ticker: string;
  sector: string;
  suggestedQuantity: number;
  suggestedEntry: number;
  suggestedStop: number;
  suggestedTarget: number | null;
  weightPct: number;
  riskAmount: number;
  riskContributionPct: number;
  correlationAdjusted: boolean;
  blocked: boolean;
  blockedReasons: string[];
  rationale: string[];
}

interface PortfolioResult {
  totalCapital: number;
  deployedCapital: number;
  availableCapital: number;
  totalExposurePct: number;
  totalRiskPct: number;
  positions: OptimizedPosition[];
  warnings: string[];
  blockedPositions: OptimizedPosition[];
  diversificationScore: number;
  maxCorrelation: number;
  generatedAt: string;
  policyVersion: string;
}

const DEFAULT_SECTORS = ['Banking', 'IT', 'Energy', 'Auto', 'FMCG', 'Pharma', 'Metals', 'Chemicals'];

export default function PortfolioPage() {
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [availableCapital, setAvailableCapital] = useState('');
  const [accountEquity, setAccountEquity] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const riskBudget = useMemo<PortfolioRiskBudget>(() => ({
    maxTotalExposurePct: 100,
    maxSinglePositionPct: 10,
    maxSectorExposurePct: 25,
    maxDailyLossPct: 2,
    maxCorrelationClusterPct: 30,
  }), []);

  const addPosition = useCallback(() => {
    setPositions((prev) => [
      ...prev,
      {
        instrumentKey: `NEW_${Date.now()}`,
        ticker: '',
        exchange: 'NSE',
        sector: 'Banking',
        side: 'long',
        quantity: 0,
        entryPrice: 0,
        currentPrice: 0,
      },
    ]);
  }, []);

  const removePosition = useCallback((index: number) => {
    setPositions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updatePosition = useCallback(
    (index: number, field: keyof PositionRow, value: string | number | 'long' | 'short' | undefined) => {
      setPositions((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
    },
    []
  );

  const runOptimization = useCallback(async () => {
    const capital = Number(availableCapital);
    const equity = Number(accountEquity);

    if (!capital || capital <= 0) {
      setError('Available capital is required.');
      return;
    }
    if (!equity || equity <= 0) {
      setError('Account equity is required.');
      return;
    }
    if (!positions.length) {
      setError('Add at least one position.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positions: positions.map((p) => ({
            instrumentKey: p.instrumentKey,
            ticker: p.ticker,
            exchange: p.exchange,
            sector: p.sector,
            side: p.side,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            marketValue: p.quantity * p.currentPrice,
            unrealizedPnl: p.quantity * (p.currentPrice - p.entryPrice),
            unrealizedPnlPct: p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0,
            weightPct: 0,
            riskContributionPct: 0,
            stopLoss: p.stopLoss,
            target: p.target,
            lastUpdated: new Date().toISOString(),
          })),
          availableCapital: capital,
          accountEquity: equity,
          riskBudget,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        setError(err.error || 'Optimization failed.');
        return;
      }

      const data = await response.json();
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed.');
    } finally {
      setLoading(false);
    }
  }, [positions, availableCapital, accountEquity, riskBudget]);

  const summary = useMemo(() => {
    if (!result) return null;
    return {
      totalCapital: result.totalCapital,
      deployedCapital: result.deployedCapital,
      availableCapital: result.availableCapital,
      totalExposurePct: result.totalExposurePct,
      totalRiskPct: result.totalRiskPct,
      diversificationScore: result.diversificationScore,
      maxCorrelation: result.maxCorrelation,
      activePositions: result.positions.filter((p) => !p.blocked).length,
      blockedPositions: result.blockedPositions.length,
      warnings: result.warnings,
    };
  }, [result]);

  return (
    <div className="page-container py-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-primary">Portfolio Optimizer</h1>
          <p className="text-muted text-sm">
            Risk-parity sizing with correlation clusters, sector caps, and exposure limits.{' '}
            <span className="text-warning">Research scenarios only — not an instruction to transact.</span>
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-primary mb-4 uppercase tracking-wider">Portfolio inputs</h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Available capital (₹)</label>
                  <input
                    type="number"
                    className="input"
                    value={availableCapital}
                    onChange={(e) => setAvailableCapital(e.target.value)}
                    placeholder="e.g. 500000"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Account equity (₹)</label>
                  <input
                    type="number"
                    className="input"
                    value={accountEquity}
                    onChange={(e) => setAccountEquity(e.target.value)}
                    placeholder="e.g. 1000000"
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">Positions</h3>
                {positions.map((pos, index) => (
                  <div key={index} className="space-y-2 p-3 bg-surface border border-border-default rounded-lg">
                    <div className="flex justify-between items-start gap-2">
                      <button
                        onClick={() => removePosition(index)}
                        className="text-negative hover:text-negative text-xs"
                        aria-label="Remove position"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-muted block mb-1">Ticker</label>
                        <input
                          className="input text-sm"
                          value={pos.ticker}
                          onChange={(e) => updatePosition(index, 'ticker', e.target.value)}
                          placeholder="RELIANCE"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted block mb-1">Sector</label>
                        <select
                          className="input text-sm"
                          value={pos.sector}
                          onChange={(e) => updatePosition(index, 'sector', e.target.value)}
                        >
                          {DEFAULT_SECTORS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted block mb-1">Current price (₹)</label>
                        <input
                          type="number"
                          className="input text-sm"
                          value={pos.currentPrice}
                          onChange={(e) => updatePosition(index, 'currentPrice', Number(e.target.value))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted block mb-1">Stop loss (₹)</label>
                        <input
                          type="number"
                          className="input text-sm"
                          value={pos.stopLoss ?? ''}
                          onChange={(e) =>
                            updatePosition(index, 'stopLoss', e.target.value ? Number(e.target.value) : undefined)
                          }
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={addPosition}
                  className="w-full btn-secondary flex items-center justify-center gap-2"
                >
                  <Plus size={14} /> Add position
                </button>
              </div>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-primary mb-4 uppercase tracking-wider">Run optimization</h2>
              <button
                onClick={runOptimization}
                disabled={loading || !availableCapital || !accountEquity || !positions.length}
                className="w-full btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Activity size={16} className="animate-spin" /> : <BarChart3 size={16} />} Optimize portfolio
              </button>
              {error && (
                <div className="mt-3 p-3 rounded bg-negative-dim text-negative text-xs border border-negative/20">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {summary && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-4">
                  <div className="text-xs text-muted uppercase tracking-wider mb-1">Deployed capital</div>
                  <div className="text-lg font-mono font-bold text-primary">₹{summary.deployedCapital.toLocaleString('en-IN')}</div>
                  <div className="text-xs text-muted mt-1">of ₹{summary.totalCapital.toLocaleString('en-IN')}</div>
                </div>
                <div className="card p-4">
                  <div className="text-xs text-muted uppercase tracking-wider mb-1">Total exposure</div>
                  <div className="text-lg font-mono font-bold text-primary">{summary.totalExposurePct}%</div>
                  <div className="text-xs text-muted mt-1">of account equity</div>
                </div>
                <div className="card p-4">
                  <div className="text-xs text-muted uppercase tracking-wider mb-1">Total risk</div>
                  <div className="text-lg font-mono font-bold text-primary">{summary.totalRiskPct}%</div>
                  <div className="text-xs text-muted mt-1">risk budget used</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="card p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-primary">Diversification</h2>
                  <PieChart size={24} className="text-accent" />
                </div>
                <div className="text-2xl font-mono font-bold text-primary">{summary ? summary.diversificationScore : '--'}</div>
                <p className="text-xs text-muted mt-2">0 = concentrated, 100 = diversified</p>
              </div>
              <div className="card p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-primary">Max correlation</h2>
                  <ShieldAlert size={24} className="text-warning" />
                </div>
                <div className="text-2xl font-mono font-bold text-primary">{summary ? summary.maxCorrelation : '--'}%</div>
                <p className="text-xs text-muted mt-2">Highest pairwise correlation in portfolio</p>
              </div>
            </div>

            {summary && summary.warnings.length > 0 && (
              <div className="card p-4 border-warning/30 bg-warning-dim">
                <h3 className="text-xs font-semibold text-warning uppercase tracking-wider mb-2">Policy warnings</h3>
                <ul className="text-xs text-warning text-muted space-y-1">
                  {summary.warnings.map((w: string, i: number) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {result && (
              <div className="card">
                <div className="p-4 border-b border-border-default">
                  <h2 className="text-sm font-semibold text-primary flex items-center gap-2">
                    <Activity size={16} className="text-accent" /> Optimized positions
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border-default bg-surface">
                        <th className="p-3 text-muted font-semibold">Ticker</th>
                        <th className="p-3 text-muted font-semibold">Sector</th>
                        <th className="p-3 text-muted font-semibold text-right">Qty</th>
                        <th className="p-3 text-muted font-semibold text-right">Entry (₹)</th>
                        <th className="p-3 text-muted font-semibold text-right">Stop (₹)</th>
                        <th className="p-3 text-muted font-semibold text-right">Weight</th>
                        <th className="p-3 text-muted font-semibold text-right">Risk</th>
                        <th className="p-3 text-muted font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([...result.positions, ...result.blockedPositions] as OptimizedPosition[]).map((p) => (
                        <tr key={p.instrumentKey} className="border-b border-border-default/50 hover:bg-surface/50">
                          <td className="p-3 font-mono">{p.ticker}</td>
                          <td className="p-3">{p.sector}</td>
                          <td className="p-3 text-right">{p.suggestedQuantity}</td>
                          <td className="p-3 text-right">{p.suggestedEntry}</td>
                          <td className="p-3 text-right">{p.suggestedStop}</td>
                          <td className="p-3 text-right">{p.weightPct}%</td>
                          <td className="p-3 text-right">{p.riskAmount.toLocaleString('en-IN')}</td>
                          <td className="p-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${
                                p.blocked
                                  ? 'bg-negative-dim text-negative border border-negative/30'
                                  : 'bg-positive-dim text-positive border border-positive/30'
                              }`}
                            >
                              {p.blocked ? <ShieldAlert size={10} /> : <BarChart3 size={10} />}
                              {p.blocked ? 'Blocked' : 'Active'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.blockedPositions.length > 0 && (
                  <div className="p-4 border-t border-border-default">
                    <h3 className="text-xs font-semibold text-negative uppercase tracking-wider mb-2">Blocked positions</h3>
                    <ul className="text-xs text-negative text-muted space-y-1">
                      {result.blockedPositions.map((p: OptimizedPosition, i: number) => (
                        <li key={i}>
                          {p.ticker}: {p.blockedReasons.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
