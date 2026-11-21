'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookMarked, Search, Trash2 } from 'lucide-react';
import type { WatchlistItem } from '@/types/research';
import { formatRelativeTime } from '@/lib/formatting/numbers';

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/watchlist')
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setWatchlist(data.watchlist ?? []); })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      setWatchlist((previous) => previous.filter((item) => item.id !== id));
    } catch {
      /* ignore */
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="page-container section-page">
      <header className="section-page-header">
        <span className="section-eyebrow">Research workspace</span>
        <h1>Watchlist</h1>
        <p>Companies saved for quick access, monitoring and follow-up research.</p>
      </header>

      {loading ? (
        <WatchlistSkeleton />
      ) : watchlist.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card watchlist-table-card">
          <div className="watchlist-table-header">
            {['Company', 'Exchange', 'Last research', 'Actions'].map((heading) => <span key={heading}>{heading}</span>)}
          </div>
          {watchlist.map((item) => (
            <WatchlistRow
              item={item}
              key={item.id}
              onRemove={() => handleRemove(item.id)}
              onResearch={() => router.push(`/?q=${encodeURIComponent(item.ticker)}`)}
              removing={removing === item.id}
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
    <div className="watchlist-row">
      <div className="watchlist-company">
        <p>{item.companyName}</p>
        <span className="ticker-badge">{item.ticker}</span>
      </div>
      <div className="watchlist-exchange"><span className="badge-neutral">{item.exchange}</span></div>
      <div className="watchlist-research-date">
        <p>{item.lastResearch ? formatRelativeTime(item.lastResearch) : 'Not researched yet'}</p>
      </div>
      <div className="watchlist-actions">
        <button aria-label={`Research ${item.companyName}`} className="icon-button" onClick={onResearch} title="Research this company" type="button">
          <Search size={16} />
        </button>
        <button aria-label={`Remove ${item.companyName} from watchlist`} className="icon-button danger" disabled={removing} onClick={onRemove} title="Remove from watchlist" type="button">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card empty-state">
      <span className="empty-state-icon"><BookMarked size={22} strokeWidth={2} /></span>
      <h2>Build your research watchlist</h2>
      <p>Save a company from its research dossier to return to it quickly and continue your analysis.</p>
      <Link className="btn-primary" href="/">
        <Search size={15} />
        <span>Research a company</span>
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function WatchlistSkeleton() {
  return (
    <div aria-label="Loading watchlist" className="card list-skeleton">
      {[1, 2, 3].map((item) => (
        <div key={item}>
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ))}
    </div>
  );
}
