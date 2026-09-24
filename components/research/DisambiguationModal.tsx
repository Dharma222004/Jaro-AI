'use client';

import { useState } from 'react';
import { ArrowLeft, Search, Building2, ChevronRight, Sparkles } from 'lucide-react';
import type { CompanyCandidate } from '@/types/company';

interface Props {
  query: string;
  candidates: CompanyCandidate[];
  onSelect: (candidate: CompanyCandidate) => void;
  onCancel: () => void;
}

export function DisambiguationModal({ query, candidates, onSelect, onCancel }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: 'fixed',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '600px',
          height: '300px',
          background: 'radial-gradient(ellipse, rgba(37,99,235,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '520px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'var(--gradient-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.1rem',
              boxShadow: '0 0 24px rgba(37,99,235,0.3)',
            }}
          >
            <Search size={22} style={{ color: '#fff' }} />
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(234,179,8,0.1)',
              border: '1px solid rgba(234,179,8,0.25)',
              borderRadius: '20px',
              padding: '0.2rem 0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <Sparkles size={11} style={{ color: '#eab308' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#eab308', letterSpacing: '0.05em' }}>
              MULTIPLE MATCHES
            </span>
          </div>

          <h2
            style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
              marginBottom: '0.4rem',
            }}
          >
            Which company do you mean?
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Found {candidates.length} matches for{' '}
            <span
              style={{
                color: 'var(--accent)',
                fontWeight: 600,
                background: 'var(--accent-dim)',
                padding: '0.1rem 0.4rem',
                borderRadius: '4px',
              }}
            >
              &ldquo;{query}&rdquo;
            </span>
          </p>
        </div>

        {/* Company cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginBottom: '1.5rem' }}>
          {candidates.map((c, idx) => (
            <button
              key={`${c.ticker}-${c.exchange}`}
              onClick={() => onSelect(c)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: hoveredIdx === idx ? 'var(--bg-surface)' : 'var(--bg-surface)',
                border: `1.5px solid ${hoveredIdx === idx ? 'var(--primary)' : 'var(--border-subtle)'}`,
                borderRadius: '12px',
                padding: '1rem 1.1rem',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                boxShadow: hoveredIdx === idx ? '0 0 0 3px rgba(37,99,235,0.1)' : 'none',
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: hoveredIdx === idx
                    ? 'linear-gradient(135deg, var(--primary), var(--accent))'
                    : 'var(--bg-elevated)',
                  border: hoveredIdx === idx ? 'none' : '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.18s ease',
                }}
              >
                <Building2
                  size={18}
                  style={{ color: hoveredIdx === idx ? '#fff' : 'var(--text-muted)' }}
                />
              </div>

              {/* Text content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
                  <p
                    style={{
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      color: hoveredIdx === idx ? 'var(--text-primary)' : 'var(--text-primary)',
                      lineHeight: 1.3,
                    }}
                  >
                    {c.name}
                  </p>
                  {/* Ticker badge */}
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '5px',
                      background: hoveredIdx === idx ? 'rgba(37,99,235,0.15)' : 'var(--bg-elevated)',
                      color: hoveredIdx === idx ? 'var(--primary)' : 'var(--text-muted)',
                      border: `1px solid ${hoveredIdx === idx ? 'rgba(37,99,235,0.3)' : 'var(--border-subtle)'}`,
                      flexShrink: 0,
                      transition: 'all 0.18s ease',
                    }}
                  >
                    {c.exchange}: {c.ticker}
                  </span>
                </div>
                {c.description && (
                  <p
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                    }}
                  >
                    {c.description}
                  </p>
                )}
              </div>

              {/* Arrow */}
              <ChevronRight
                size={18}
                style={{
                  color: hoveredIdx === idx ? 'var(--primary)' : 'var(--border-default)',
                  flexShrink: 0,
                  transition: 'color 0.18s, transform 0.18s',
                  transform: hoveredIdx === idx ? 'translateX(3px)' : 'none',
                }}
              />
            </button>
          ))}

          {candidates.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                background: 'var(--bg-surface)',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                No matching companies found.
                <br />
                <span style={{ color: 'var(--text-secondary)' }}>
                  Try using the full company name or NSE/BSE ticker symbol.
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Back button */}
        <button
          onClick={onCancel}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: 'none',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: '0.86rem',
            fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          <ArrowLeft size={15} />
          Back to Search
        </button>
      </div>
    </div>
  );
}
