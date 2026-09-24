'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookMarked, Trash2, Search, ArrowRight } from 'lucide-react';
import type { WatchlistItem } from '@/types/research';
import { formatRelativeTime } from '@/lib/formatting/numbers';

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchWatchlist();
  }, []);

  const fetchWatchlist = async () => {
    try {
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      setWatchlist(data.watchlist ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      setWatchlist((prev) => prev.filter((w) => w.id !== id));
    } catch {
      /* ignore */
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="page-container" style={{ padding: '3rem 1.5rem', maxWidth: '760px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
          Watchlist
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
          Companies you&apos;ve saved for quick access and tracking.
        </p>
      </div>

      {loading ? (
        <WatchlistSkeleton />
      ) : watchlist.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
          {/* Table header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '5fr 2fr 3fr 2fr',
              padding: '0.75rem 1rem',
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {['Company', 'Exchange', 'Last Research', 'Actions'].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {watchlist.map((item) => (
            <WatchlistRow
              key={item.id}
              item={item}
              removing={removing === item.id}
              onRemove={() => handleRemove(item.id)}
              onResearch={() => router.push(`/dashboard`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistRow({
  item,
  removing,
  onRemove,
  onResearch,
}: {
  item: WatchlistItem;
  removing: boolean;
  onRemove: () => void;
  onResearch: () => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '5fr 2fr 3fr 2fr',
        padding: '0.85rem 1rem',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Company */}
      <div>
        <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem', color: 'var(--text-primary)' }}>
          {item.companyName}
        </p>
        <span className="ticker-badge">{item.ticker}</span>
      </div>

      {/* Exchange */}
      <div>
        <span className="badge-neutral">{item.exchange}</span>
      </div>

      {/* Last Research */}
      <div>
        {item.lastResearch ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {formatRelativeTime(item.lastResearch)}
          </p>
        ) : (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Not researched</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <button
          onClick={onResearch}
          className="btn-ghost"
          style={{ padding: '0.35rem' }}
          title="Research this company"
        >
          <Search size={14} />
        </button>
        <button
          onClick={onRemove}
          disabled={removing}
          className="btn-ghost"
          style={{ padding: '0.35rem', color: 'var(--negative)' }}
          title="Remove from watchlist"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
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
        <BookMarked size={22} strokeWidth={2.2} />
      </div>

      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
        No Companies Saved
      </h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '380px', lineHeight: 1.5, marginBottom: '1.75rem' }}>
        After researching a company on the terminal, click &ldquo;+ Watchlist&rdquo; to save and monitor it here.
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
        <span>Search Companies</span>
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function WatchlistSkeleton() {
  return (
    <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
          <div className="skeleton" style={{ height: '1rem', width: '40%', borderRadius: '4px' }} />
          <div className="skeleton" style={{ height: '1rem', width: '15%', borderRadius: '4px' }} />
          <div className="skeleton" style={{ height: '1rem', width: '20%', borderRadius: '4px' }} />
        </div>
      ))}
    </div>
  );
}
