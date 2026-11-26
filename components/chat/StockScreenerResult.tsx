'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  BookmarkPlus,
  Check,
  Download,
  ExternalLink,
  Filter,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Star,
  X,
} from 'lucide-react';
import type {
  ScreenerCandidateRow,
  ScreenerExchangeFilter,
  ScreenerExecutionResult,
  ScreenerSortField,
  ScreenerSpec,
} from '@/types/screener';
import { ensureSignedSession } from '@/lib/memory/client';
import { buildScreenerCsv } from '@/lib/screener/export-service';

interface StockScreenerResultProps {
  initialResult: ScreenerExecutionResult;
  onOpenCompany?: (prompt: string) => void;
}

const SORT_OPTIONS: Array<{ value: ScreenerSortField; label: string }> = [
  { value: 'market_cap_cr', label: 'Market Cap' },
  { value: 'daily_volume', label: 'Daily Volume' },
  { value: 'price', label: 'Price' },
  { value: 'diff_from_sma_50_pct', label: 'Diff vs SMA 50' },
  { value: 'roe_pct', label: 'ROE %' },
  { value: 'roce_pct', label: 'ROCE %' },
  { value: 'rsi_14', label: 'RSI (14)' },
  { value: 'pe', label: 'P/E Ratio' },
];

export function StockScreenerResult({ initialResult, onOpenCompany }: StockScreenerResultProps) {
  const [result, setResult] = useState<ScreenerExecutionResult>(initialResult);
  const [spec, setSpec] = useState<ScreenerSpec>(initialResult.spec);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchangeTab, setExchangeTab] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editQuery, setEditQuery] = useState('');
  const [showAddFilter, setShowAddFilter] = useState(false);
  const [watchlistAdded, setWatchlistAdded] = useState<Record<string, boolean>>({});

  const filteredAndSortedRows = useMemo(() => {
    let list = [...result.rows];
    if (exchangeTab === 'NSE') {
      list = list.filter((r) => Boolean(r.nseSymbol) || r.exchangeLabel.includes('NSE'));
    } else if (exchangeTab === 'BSE') {
      list = list.filter((r) => Boolean(r.bseCode) || r.exchangeLabel.includes('BSE'));
    }

    const dir = spec.sortOrder === 'ASC' ? 1 : -1;
    list.sort((a, b) => {
      const getVal = (r: ScreenerCandidateRow): number | null => {
        switch (spec.sortBy) {
          case 'market_cap_cr': return r.marketCapCr;
          case 'daily_volume': return r.dailyVolumeShares;
          case 'price': return r.price;
          case 'diff_from_sma_50_pct': return r.diffFromSma50Pct;
          case 'roe_pct': return r.roePct;
          case 'roce_pct': return r.rocePct;
          case 'rsi_14': return r.rsi14;
          case 'pe': return r.pe;
          default: return r.marketCapCr;
        }
      };
      const va = getVal(a);
      const vb = getVal(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
    return list;
  }, [result.rows, exchangeTab, spec.sortBy, spec.sortOrder]);

  const rerunScreener = async (nextSpec: ScreenerSpec, overrideQuery?: string) => {
    setRunning(true);
    setError(null);
    try {
      const token = await ensureSignedSession().catch(() => '');
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: overrideQuery ?? nextSpec.rawQuery,
          spec: overrideQuery ? undefined : nextSpec,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.result) {
        throw new Error(data.error || 'Failed to rerun stock screener');
      }
      setResult(data.result);
      setSpec(data.result.spec);
      setEditQuery('');
      setShowAddFilter(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rerun screener.');
    } finally {
      setRunning(false);
    }
  };

  const removeCondition = (condId: string) => {
    const nextSpec: ScreenerSpec = {
      ...spec,
      conditions: spec.conditions.filter((c) => c.id !== condId),
    };
    setSpec(nextSpec);
    void rerunScreener(nextSpec);
  };

  const setUniverseExchange = (ex: ScreenerExchangeFilter) => {
    const nextSpec: ScreenerSpec = { ...spec, exchanges: ex };
    setSpec(nextSpec);
    void rerunScreener(nextSpec);
  };

  const handleExportCsv = () => {
    const csv = buildScreenerCsv(filteredAndSortedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jaro-screener-${result.jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveScreener = async () => {
    if (!saveName.trim()) return;
    setSaveStatus('saving');
    try {
      const token = await ensureSignedSession().catch(() => '');
      const res = await fetch('/api/screener/saved', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: saveName.trim(),
          spec,
          lastMatchCount: result.coverage.matchedCount,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveOpen(false);
        setSaveStatus('idle');
      }, 1200);
    } catch {
      setSaveStatus('error');
    }
  };

  const handleAddWatchlist = async (row: ScreenerCandidateRow) => {
    try {
      const token = await ensureSignedSession().catch(() => '');
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ticker: row.nseSymbol ?? row.primaryTicker,
          name: row.name,
          exchange: row.nseSymbol ? 'NSE' : 'BSE',
          sector: row.sector ?? undefined,
        }),
      });
      if (res.ok) {
        setWatchlistAdded((prev) => ({ ...prev, [row.companyId]: true }));
      }
    } catch {
      // ignore silently
    }
  };

  const cov = result.coverage;

  return (
    <div className="screener-card">
      {/* Header */}
      <div className="screener-header">
        <div className="screener-header-left">
          <div className="screener-title-row">
            <span className="screener-brand-badge">JARO AI · STOCK SCREENER</span>
            <span className={`screener-market-pill ${result.marketStatus}`}>
              Market {result.marketStatus.toUpperCase()}
            </span>
          </div>
          <p className="screener-query-text">{result.query}</p>
          <div className="screener-meta-line">
            <span>Exchanges: {spec.exchanges === 'BOTH' ? 'NSE + BSE' : spec.exchanges}</span>
            <span>·</span>
            <span>{spec.conditions.length} condition{spec.conditions.length === 1 ? '' : 's'} ({spec.logicalOperator})</span>
            <span>·</span>
            <span>Executed: {result.executionTimestampIst}</span>
          </div>
        </div>

        <div className="screener-header-actions">
          <button
            type="button"
            className="screener-btn primary"
            onClick={() => void rerunScreener(spec)}
            disabled={running}
          >
            {running ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            <span>Run again</span>
          </button>
          <button type="button" className="screener-btn" onClick={handleExportCsv} disabled={filteredAndSortedRows.length === 0}>
            <Download size={14} />
            <span>Export CSV</span>
          </button>
          <button type="button" className="screener-btn" onClick={() => setSaveOpen(!saveOpen)}>
            <BookmarkPlus size={14} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Save Screener inline drawer */}
      {saveOpen && (
        <div className="screener-inline-bar">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name this screen (e.g. Large-cap above SMA 50)"
            className="screener-input"
          />
          <button type="button" className="screener-btn primary" onClick={() => void handleSaveScreener()} disabled={saveStatus === 'saving'}>
            {saveStatus === 'saved' ? <Check size={14} /> : null}
            <span>{saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Save Criteria'}</span>
          </button>
        </div>
      )}

      {/* Editable Filter Chips */}
      <div className="screener-filters-bar">
        <div className="screener-chips-wrap">
          <span className="screener-chips-label"><Filter size={12} /> Filters:</span>
          {spec.conditions.map((cond) => (
            <span key={cond.id} className="screener-filter-chip">
              <span>{cond.label}</span>
              <button
                type="button"
                aria-label={`Remove ${cond.label}`}
                onClick={() => removeCondition(cond.id)}
                disabled={running}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {spec.sector && (
            <span className="screener-filter-chip">
              <span>Sector: {spec.sector}</span>
              <button
                type="button"
                aria-label="Remove sector filter"
                onClick={() => {
                  const nextSpec = { ...spec, sector: null };
                  setSpec(nextSpec);
                  void rerunScreener(nextSpec);
                }}
                disabled={running}
              >
                <X size={11} />
              </button>
            </span>
          )}
          <button type="button" className="screener-add-chip-btn" onClick={() => setShowAddFilter(!showAddFilter)}>
            <Plus size={12} /> Edit / New Query
          </button>
        </div>

        <div className="screener-controls-row">
          <div className="screener-seg">
            {(['BOTH', 'NSE', 'BSE'] as const).map((ex) => (
              <button
                key={ex}
                type="button"
                className={spec.exchanges === ex ? 'active' : ''}
                onClick={() => setUniverseExchange(ex)}
                disabled={running}
              >
                {ex === 'BOTH' ? 'NSE + BSE' : ex}
              </button>
            ))}
          </div>

          <div className="screener-sort-wrap">
            <ArrowDownUp size={13} />
            <select
              value={spec.sortBy}
              onChange={(e) => setSpec({ ...spec, sortBy: e.target.value as ScreenerSortField })}
              aria-label="Sort results by"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="screener-sort-dir"
              onClick={() => setSpec({ ...spec, sortOrder: spec.sortOrder === 'DESC' ? 'ASC' : 'DESC' })}
              title={`Order: ${spec.sortOrder}`}
            >
              {spec.sortOrder}
            </button>
          </div>
        </div>
      </div>

      {showAddFilter && (
        <div className="screener-inline-bar">
          <Search size={14} className="text-muted" />
          <input
            type="text"
            value={editQuery}
            onChange={(e) => setEditQuery(e.target.value)}
            placeholder="e.g. Stocks above SMA 50 with volume > 20 lakh and market cap > 50000 Cr"
            className="screener-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editQuery.trim()) void rerunScreener(spec, editQuery.trim());
            }}
          />
          <button
            type="button"
            className="screener-btn primary"
            onClick={() => editQuery.trim() && void rerunScreener(spec, editQuery.trim())}
            disabled={running || !editQuery.trim()}
          >
            Apply & Run
          </button>
        </div>
      )}

      {/* Coverage Summary */}
      <div className="screener-coverage-strip">
        <div><span>Eligible Universe</span><strong>{cov.totalEligibleSecurities.toLocaleString('en-IN')}</strong></div>
        <div><span>Evaluated</span><strong>{cov.validQuoteCount.toLocaleString('en-IN')}</strong></div>
        <div className="highlight"><span>Matched</span><strong>{cov.matchedCount.toLocaleString('en-IN')}</strong></div>
        <div><span>Excluded</span><strong>{cov.excludedCount.toLocaleString('en-IN')}</strong></div>
        <div><span>Unavailable Data</span><strong>{cov.unavailableCount.toLocaleString('en-IN')}</strong></div>
      </div>

      {result.limitations.length > 0 && (
        <div className="screener-notice">
          {result.limitations.map((lim, idx) => <p key={idx}>• {lim}</p>)}
        </div>
      )}

      {error && <div className="screener-error">{error}</div>}

      {/* View Exchange Filter Tabs */}
      {result.rows.length > 0 && (
        <div className="screener-view-tabs">
          {(['ALL', 'NSE', 'BSE'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={exchangeTab === tab ? 'active' : ''}
              onClick={() => setExchangeTab(tab)}
            >
              {tab === 'ALL' ? `All Matches (${result.rows.length})` : `${tab} Listed`}
            </button>
          ))}
        </div>
      )}

      {/* Empty State */}
      {filteredAndSortedRows.length === 0 ? (
        <div className="screener-empty">
          <strong>0 companies matched all evaluated criteria</strong>
          <p>
            Evaluated {cov.validQuoteCount} securities across {spec.exchanges === 'BOTH' ? 'NSE + BSE' : spec.exchanges}.
            {cov.unavailableCount > 0 ? ` ${cov.unavailableCount} securities lacked verified data for at least one mandatory filter and were excluded rather than guessed.` : ''}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="screener-table-wrap">
            <table className="screener-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>NSE</th>
                  <th>BSE</th>
                  <th className="num">Price</th>
                  <th className="num">SMA 50</th>
                  <th className="num">Diff %</th>
                  <th className="num">Daily Volume</th>
                  <th className="num">Market Cap</th>
                  <th>Exchange</th>
                  <th>Source</th>
                  <th>Timestamp</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedRows.map((row) => (
                  <tr key={row.companyId}>
                    <td>
                      <button
                        type="button"
                        className="screener-company-link"
                        onClick={() => onOpenCompany?.(`Analyse ${row.nseSymbol ?? row.primaryTicker}`)}
                      >
                        <strong>{row.name}</strong>
                        {row.sector ? <small>{row.sector}</small> : null}
                      </button>
                    </td>
                    <td className="mono">{row.nseSymbol ?? '—'}</td>
                    <td className="mono">{row.bseCode ?? '—'}</td>
                    <td className="num mono">₹{row.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="num mono">{row.sma50 != null ? `₹${row.sma50.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>
                    <td className={`num mono ${row.diffFromSma50Pct != null && row.diffFromSma50Pct >= 0 ? 'pos' : 'neg'}`}>
                      {row.diffFromSma50Pct != null ? `${row.diffFromSma50Pct >= 0 ? '+' : ''}${row.diffFromSma50Pct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="num mono">{row.dailyVolumeShares != null ? formatVolume(row.dailyVolumeShares) : '—'}</td>
                    <td className="num mono">{row.marketCapCr != null ? `₹${Math.round(row.marketCapCr).toLocaleString('en-IN')} Cr` : '—'}</td>
                    <td><span className="screener-ex-tag">{row.exchangeLabel}</span></td>
                    <td className="src">{row.quoteProvider}</td>
                    <td className="ts">{formatShortTime(row.priceTimestamp)}</td>
                    <td>
                      <div className="screener-row-actions">
                        <button
                          type="button"
                          title="Add to watchlist"
                          onClick={() => void handleAddWatchlist(row)}
                          className={watchlistAdded[row.companyId] ? 'added' : ''}
                        >
                          <Star size={13} />
                        </button>
                        <button
                          type="button"
                          title="Open company research"
                          onClick={() => onOpenCompany?.(`Analyse ${row.nseSymbol ?? row.primaryTicker}`)}
                        >
                          <ExternalLink size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="screener-mobile-cards">
            {filteredAndSortedRows.map((row) => (
              <div key={row.companyId} className="screener-mobile-card">
                <div className="screener-mobile-top">
                  <button
                    type="button"
                    className="screener-company-link"
                    onClick={() => onOpenCompany?.(`Analyse ${row.nseSymbol ?? row.primaryTicker}`)}
                  >
                    <strong>{row.name}</strong>
                    <small>{row.nseSymbol ?? row.primaryTicker}{row.bseCode ? ` · BSE ${row.bseCode}` : ''} · {row.exchangeLabel}</small>
                  </button>
                  <div className="screener-mobile-price">
                    <strong>₹{row.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
                    {row.diffFromSma50Pct != null && (
                      <span className={row.diffFromSma50Pct >= 0 ? 'pos' : 'neg'}>
                        {row.diffFromSma50Pct >= 0 ? '+' : ''}{row.diffFromSma50Pct.toFixed(2)}% vs SMA50
                      </span>
                    )}
                  </div>
                </div>

                <div className="screener-mobile-metrics">
                  <div><span>SMA 50</span><strong>{row.sma50 != null ? `₹${row.sma50.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</strong></div>
                  <div><span>Volume</span><strong>{row.dailyVolumeShares != null ? formatVolume(row.dailyVolumeShares) : '—'}</strong></div>
                  <div><span>Market Cap</span><strong>{row.marketCapCr != null ? `₹${Math.round(row.marketCapCr).toLocaleString('en-IN')} Cr` : '—'}</strong></div>
                </div>

                <div className="screener-mobile-foot">
                  <span className="screener-mobile-src">{row.quoteProvider} · {formatShortTime(row.priceTimestamp)}</span>
                  <div className="screener-row-actions">
                    <button
                      type="button"
                      onClick={() => void handleAddWatchlist(row)}
                      className={watchlistAdded[row.companyId] ? 'added' : ''}
                    >
                      <Star size={13} /> <span>{watchlistAdded[row.companyId] ? 'Saved' : 'Watchlist'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenCompany?.(`Analyse ${row.nseSymbol ?? row.primaryTicker}`)}
                    >
                      <ExternalLink size={13} /> <span>Research</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatVolume(shares: number): string {
  if (shares >= 1e7) return `${(shares / 1e7).toFixed(2)} Cr`;
  if (shares >= 1e5) return `${(shares / 1e5).toFixed(2)} L`;
  return shares.toLocaleString('en-IN');
}

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}
