'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, ArrowRight, Search, FileText, Loader2 } from 'lucide-react';

interface HistoryItem {
  id: string;
  companyName: string;
  ticker: string | null;
  exchange: string | null;
  query: string;
  status: string;
  createdAt: string;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/research/history?limit=30')
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data.history)) {
          setHistory(data.history);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page-container" style={{ padding: '3rem 1.5rem', maxWidth: '820px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
            Research History
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Archived institutional equity reports and interactive analyst sessions.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="btn-gradient"
          style={{
            padding: '0.55rem 1.1rem',
            fontSize: '0.82rem',
            borderRadius: '8px',
          }}
        >
          <Search size={14} />
          <span>New Research</span>
        </Link>
      </div>

      {loading ? (
        <div
          className="card"
          style={{
            padding: '3rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem',
            color: 'var(--text-muted)',
            fontSize: '0.88rem',
          }}
        >
          <Loader2 size={18} className="animate-spin" />
          <span>Loading archived research reports...</span>
        </div>
      ) : history.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '3.5rem 2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
          }}
        >
          <div
            style={{
              width: '3.25rem',
              height: '3.25rem',
              borderRadius: '12px',
              background: 'var(--gradient-brand-subtle)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1.25rem',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Clock size={24} strokeWidth={2.2} />
          </div>

          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
            No Research History Yet
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '380px', lineHeight: 1.5, marginBottom: '1.75rem' }}>
            When you research a company on the terminal, your institutional equity dossier and analyst chat will be preserved and accessible here.
          </p>

          <Link
            href="/dashboard"
            className="btn-gradient"
            style={{
              padding: '0.65rem 1.35rem',
              fontSize: '0.88rem',
              borderRadius: '8px',
            }}
          >
            <Search size={15} />
            <span>Launch Research Terminal</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {history.map((item) => (
            <Link
              key={item.id}
              href={`/history/${item.id}`}
              className="card"
              style={{
                padding: '1.1rem 1.35rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                textDecoration: 'none',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', minWidth: 0 }}>
                <div
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    borderRadius: '8px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  <FileText size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {item.companyName}
                    </span>
                    {item.ticker && (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: 'var(--accent)',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '4px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {item.exchange ?? 'NSE'}: {item.ticker}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.2rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Query: &ldquo;{item.query}&rdquo;
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexShrink: 0 }}>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {new Date(item.createdAt).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                <ArrowRight size={15} style={{ color: 'var(--text-muted)' }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
