'use client';

import { Sparkles, Loader2 } from 'lucide-react';

interface Props {
  query: string;
  stages?: any[];
}

export function ResearchProgress({ query }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '65vh',
        padding: '2rem 1.5rem',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '520px',
          width: '100%',
          padding: '3.5rem 2.5rem',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          background: 'var(--bg-surface)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.25)',
        }}
      >
        {/* Animated Brand Glow Orb */}
        <div
          style={{
            position: 'relative',
            width: '4rem',
            height: '4rem',
            borderRadius: '50%',
            background: 'var(--gradient-brand-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.75rem',
            border: '1px solid var(--border-default)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '-6px',
              borderRadius: '50%',
              border: '2px solid var(--accent)',
              opacity: 0.35,
              animation: 'spin 3s linear infinite',
            }}
          />
          <Loader2
            size={28}
            className="animate-spin"
            style={{ color: 'var(--accent)', strokeWidth: 2.2 }}
          />
        </div>

        {/* Simple & Clean Header */}
        <h2
          style={{
            fontSize: '1.45rem',
            fontWeight: 800,
            letterSpacing: '-0.025em',
            color: 'var(--text-primary)',
            marginBottom: '0.6rem',
            lineHeight: 1.3,
          }}
        >
          Jaro AI is <span className="text-gradient-brand">Analyzing and Gathering Information</span>
        </h2>

        {/* Clean Context */}
        <p
          style={{
            fontSize: '0.9rem',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            maxWidth: '380px',
          }}
        >
          Compiling equity research dossier for{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>&ldquo;{query}&rdquo;</strong>
        </p>

        {/* Smooth Ambient Loading Line */}
        <div
          style={{
            width: '100%',
            maxWidth: '280px',
            height: '3px',
            borderRadius: '999px',
            background: 'var(--bg-elevated)',
            overflow: 'hidden',
            marginTop: '2rem',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: '100%',
              width: '40%',
              borderRadius: '999px',
              background: 'var(--gradient-brand)',
              animation: 'pulse 1.8s ease-in-out infinite',
            }}
          />
        </div>
      </div>
    </div>
  );
}
