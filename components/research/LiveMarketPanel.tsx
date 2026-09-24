'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Activity, WifiOff } from 'lucide-react';
import type { LiveMarketData } from '@/lib/yahoo-finance/client';

interface LiveMarketPanelProps {
  ticker: string;
  exchange: 'NSE' | 'BSE';
  /** Auto-refresh interval in seconds. Default: 120 (2 min) */
  refreshInterval?: number;
}

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCr(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  const cr = n / 1e7; // Yahoo returns raw INR, 1 Cr = 10^7
  // Above 10 lakh Cr (e.g. Reliance ~16.5L Cr), show in Lakh Cr
  if (Math.abs(cr) >= 1e6) return `₹${(cr / 1e5).toFixed(2)} Lakh Cr`;
  // Otherwise show full Cr value in Indian number format: 3,36,316 Cr
  return `₹${Math.round(cr).toLocaleString('en-IN')} Cr`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700, lineHeight: 1.2 }}>
        {value}
        {sub && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.2rem' }}>{sub}</span>}
      </span>
    </div>
  );
}

export function LiveMarketPanel({ ticker, exchange, refreshInterval = 120 }: LiveMarketPanelProps) {
  const [data, setData] = useState<LiveMarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/market/quote?ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to load market data (${res.status})`);
        return;
      }
      const json: LiveMarketData = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch {
      setError('Unable to reach Yahoo Finance. Market data unavailable.');
    } finally {
      setLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  }, [ticker, exchange]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(() => fetchData(), refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  const isPositive = (data?.priceChangePct ?? 0) >= 0;
  const changeColor = isPositive ? 'var(--positive)' : 'var(--negative)';

  // Loading skeleton
  if (loading) {
    return (
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <Activity size={16} style={{ color: 'var(--accent)', animation: 'pulse 1.5s infinite' }} />
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Fetching live market data for {ticker}.{exchange}…
        </span>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
        }}
      >
        <WifiOff size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Live data unavailable — {error ?? 'Yahoo Finance did not return data for this ticker.'}
        </span>
        <button
          onClick={() => fetchData(true)}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: '1px solid var(--border-subtle)',
            borderRadius: '5px',
            padding: '0.3rem 0.6rem',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          <RefreshCw size={11} />
          Retry
        </button>
      </div>
    );
  }

  // Price position in 52W range
  const rangeWidth = data.high52w - data.low52w;
  const rangePct = rangeWidth > 0 ? Math.max(2, Math.min(98, ((data.price - data.low52w) / rangeWidth) * 100)) : 50;

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Top bar: price + change */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: isPositive
            ? 'linear-gradient(135deg, rgba(20,184,166,0.07) 0%, transparent 70%)'
            : 'linear-gradient(135deg, rgba(239,68,68,0.07) 0%, transparent 70%)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >

        {/* Price */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            ₹{fmt(data.price)}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            {isPositive ? (
              <TrendingUp size={15} style={{ color: changeColor }} />
            ) : (
              <TrendingDown size={15} style={{ color: changeColor }} />
            )}
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: changeColor }}>
              {isPositive ? '+' : ''}{fmt(data.priceChange)} ({isPositive ? '+' : ''}{fmt(data.priceChangePct)}%)
            </span>
          </div>
        </div>

        {/* Day range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          <span>L: ₹{fmt(data.dayLow)}</span>
          <span style={{ opacity: 0.4 }}>|</span>
          <span>H: ₹{fmt(data.dayHigh)}</span>
        </div>

        {/* Last updated + refresh */}
        <button
          onClick={() => fetchData(true)}
          disabled={isRefreshing}
          title="Refresh live data"
          style={{
            background: 'none',
            border: 'none',
            padding: '0.2rem',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontSize: '0.7rem',
            flexShrink: 0,
          }}
        >
          <RefreshCw size={12} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          {lastUpdated && (
            <span>
              {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </button>
      </div>

      {/* 52W Range bar */}
      <div style={{ padding: '0.65rem 1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
          <span>
            ₹{fmt(data.low52w)}
            <span style={{ color: 'var(--positive)', marginLeft: '0.3rem' }}>
              (+₹{fmt(data.price - data.low52w, 0)} from Low)
            </span>
          </span>
          <span style={{ opacity: 0.5 }}>52W Range</span>
          <span>
            ₹{fmt(data.high52w)}
            <span style={{ color: 'var(--negative)', marginLeft: '0.3rem' }}>
              (−₹{fmt(data.high52w - data.price, 0)} from High)
            </span>
          </span>
        </div>
        <div style={{ height: '5px', background: 'var(--border-subtle)', borderRadius: '3px', position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: `${rangePct}%`,
              top: '-3px',
              width: '11px',
              height: '11px',
              borderRadius: '50%',
              background: isPositive ? 'var(--positive)' : 'var(--negative)',
              transform: 'translateX(-50%)',
              boxShadow: `0 0 6px ${isPositive ? 'var(--positive)' : 'var(--negative)'}`,
            }}
          />
          <div
            style={{
              height: '100%',
              width: `${rangePct}%`,
              background: 'var(--gradient-brand)',
              borderRadius: '3px',
              opacity: 0.5,
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: '1rem 1.5rem',
          padding: '1rem 1.25rem',
        }}
      >
        <Stat label="Market Cap" value={fmtCr(data.marketCap)} />
        <Stat label="P/E (TTM)" value={data.trailingPE != null ? `${fmt(data.trailingPE)}x` : '—'} />
        <Stat label="P/B" value={data.priceToBook != null ? `${fmt(data.priceToBook)}x` : '—'} />
        <Stat label="EPS (TTM)" value={data.eps != null ? `₹${fmt(data.eps)}` : '—'} />
        <Stat label="Fwd P/E" value={data.forwardPE != null ? `${fmt(data.forwardPE)}x` : '—'} />
        <Stat label="EV/EBITDA" value={data.evEbitda != null ? `${fmt(data.evEbitda)}x` : '—'} />
        <Stat label="Div. Yield" value={fmtPct(data.dividendYield)} />
        <Stat label="Beta" value={data.beta != null ? fmt(data.beta) : '—'} />
        <Stat label="Volume" value={data.volume > 0 ? (data.volume / 1e5).toFixed(1) + 'L' : '—'} />
        <Stat label="Prev Close" value={data.previousClose > 0 ? `₹${fmt(data.previousClose)}` : '—'} />
        {data.returnOnEquity != null && <Stat label="ROE" value={fmtPct(data.returnOnEquity)} />}
        {data.debtToEquity != null && <Stat label="Debt/Equity" value={`${fmt(data.debtToEquity)}%`} />}
      </div>

      {/* Analyst section if available */}
      {(data.targetMeanPrice != null || data.recommendationKey) && (
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <AlertCircle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Analyst Consensus ({data.numberOfAnalystOpinions} analysts):
            </span>
          </div>
          {data.recommendationKey && (
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.2rem 0.6rem',
                borderRadius: '5px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                background: data.recommendationKey.includes('buy')
                  ? 'rgba(20,184,166,0.12)'
                  : data.recommendationKey.includes('sell')
                  ? 'rgba(239,68,68,0.12)'
                  : 'rgba(161,161,170,0.12)',
                color: data.recommendationKey.includes('buy')
                  ? 'var(--positive)'
                  : data.recommendationKey.includes('sell')
                  ? 'var(--negative)'
                  : 'var(--text-muted)',
                border: '1px solid currentColor',
              }}
            >
              {data.recommendationKey.replace(/_/g, ' ')}
            </span>
          )}
          {data.targetMeanPrice != null && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Target: ₹{fmt(data.targetMeanPrice)} &nbsp;
              <span style={{ color: data.targetMeanPrice > data.price ? 'var(--positive)' : 'var(--negative)', fontWeight: 700 }}>
                ({data.targetMeanPrice > data.price ? '+' : ''}{(((data.targetMeanPrice - data.price) / data.price) * 100).toFixed(1)}% upside)
              </span>
            </span>
          )}
        </div>
      )}

      {/* Data source disclaimer */}
      <div style={{ padding: '0.45rem 1.25rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          Data sourced via Yahoo Finance · May be delayed 15–20 min · Not for trading decisions
        </span>
      </div>
    </div>
  );
}
