'use client';

import Link from 'next/link';
import { Clock, ArrowRight, Search } from 'lucide-react';

export default function HistoryPage() {
  return (
    <div className="page-container" style={{ padding: '3rem 1.5rem', maxWidth: '720px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
          Research History
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
          Archived equity reports and historical analyses.
        </p>
      </div>

      {/* Clean Empty State */}
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
          When you research a company on the terminal, your institutional equity dossier will be preserved and accessible here.
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
    </div>
  );
}
