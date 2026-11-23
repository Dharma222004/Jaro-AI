'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  FileText,
  MessageSquare,
  Search,
  Trash2,
} from 'lucide-react';
import { STORAGE_KEY, CURRENT_KEY, type LocalConversation, relativeTime } from '@/components/chat/types';

interface ServerReport {
  id: string;
  companyName: string;
  ticker: string;
  exchange: string;
  query: string;
  status: string;
  createdAt: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'conversations' | 'reports'>('conversations');
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [reports, setReports] = useState<ServerReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LocalConversation[];
        if (Array.isArray(parsed)) {
          setConversations(parsed.filter((c) => c.messages.length > 0));
        }
      }
    } catch (err) {
      console.warn('[History] Failed to load conversations from storage:', err);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReportsLoading(true);
    fetch('/api/research/history')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.history)) {
          setReports(data.history);
        }
      })
      .catch((err) => {
        console.warn('[History] Failed to fetch server reports:', err);
      })
      .finally(() => {
        if (!cancelled) setReportsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openConversation = (id: string) => {
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {
      // ignore
    }
    router.push('/');
  };

  const deleteConversation = (id: string) => {
    if (!window.confirm('Delete this saved conversation? This cannot be undone.')) return;
    const updated = conversations.filter((c) => c.id !== id);
    setConversations(updated);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const all = (JSON.parse(stored) as LocalConversation[]).filter((c) => c.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        if (localStorage.getItem(CURRENT_KEY) === id && all.length > 0) {
          localStorage.setItem(CURRENT_KEY, all[0].id);
        }
      }
    } catch {
      // ignore
    }
  };

  const clearAllConversations = () => {
    if (!window.confirm('Are you sure you want to delete ALL saved conversations from this browser? This action cannot be undone.')) return;
    setConversations([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CURRENT_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="page-container history-page-redesign">
      <header className="history-compact-header">
        <span className="section-eyebrow">Saved Research</span>
        <h1 className="history-page-title">Research History</h1>
        <p className="history-page-desc">
          Past equity dialogues, valuation models, and archived company research.
        </p>
      </header>

      {/* Responsive Segmented Control Tabs */}
      <div className="history-segmented-tabs" role="tablist" aria-label="History categories">
        <button
          role="tab"
          aria-selected={activeTab === 'conversations'}
          className={`history-segment-btn ${activeTab === 'conversations' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('conversations')}
        >
          <MessageSquare size={14} />
          <span>Conversations ({conversations.length})</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'reports'}
          className={`history-segment-btn ${activeTab === 'reports' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <FileText size={14} />
          <span>Archived Reports ({reports.length})</span>
        </button>
      </div>

      {activeTab === 'conversations' ? (
        <section aria-labelledby="conversations-heading" className="history-tab-content">
          <div className="history-sub-toolbar">
            <h2 id="conversations-heading" className="sr-only">Saved Conversations</h2>
            {conversations.length > 0 && (
              <button
                className="btn-clear-all"
                onClick={clearAllConversations}
                title="Clear all saved conversations"
                type="button"
              >
                <Trash2 size={12} />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {!hydrated ? (
            <div className="history-skeleton-list">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="card history-empty-card">
              <span className="empty-icon-wrap"><Clock3 size={24} /></span>
              <h3>No conversations yet</h3>
              <p>Your equity research dialogues, questions, and decisions will be preserved here.</p>
              <Link className="btn-primary" href="/">
                <Search size={14} />
                <span>Start Research</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="history-cards-grid">
              {conversations.map((conv) => {
                const activeTickers = conv.context?.activeCompanies?.map((c) => c.ticker) ?? [];
                const firstUserMsg = conv.messages.find((m) => m.role === 'user')?.content;
                return (
                  <article className="card history-card" key={conv.id}>
                    <div className="history-card-header">
                      <div className="history-card-badges">
                        <span className="history-time-badge">{relativeTime(conv.updatedAt)}</span>
                        <span className="history-count-badge">{conv.messages.length} msgs</span>
                        {activeTickers.map((ticker) => (
                          <span className="ticker-badge" key={ticker}>{ticker}</span>
                        ))}
                      </div>
                    </div>

                    <h3 className="history-card-title">{conv.title || 'Untitled Research'}</h3>

                    {firstUserMsg && (
                      <p className="history-card-snippet">
                        {firstUserMsg.slice(0, 120)}...
                      </p>
                    )}

                    <div className="history-card-actions">
                      <button
                        className="btn-resume"
                        onClick={() => openConversation(conv.id)}
                        type="button"
                      >
                        <span>Resume</span>
                        <ArrowRight size={13} />
                      </button>
                      <button
                        aria-label={`Delete conversation: ${conv.title}`}
                        className="btn-delete-card"
                        onClick={() => deleteConversation(conv.id)}
                        title="Delete conversation"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section aria-labelledby="reports-heading" className="history-tab-content">
          <div className="history-sub-toolbar">
            <h2 id="reports-heading" className="sr-only">Archived Reports</h2>
          </div>

          {reportsLoading ? (
            <div className="history-skeleton-list">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          ) : reports.length === 0 ? (
            <div className="card history-empty-card">
              <span className="empty-icon-wrap"><FileText size={24} /></span>
              <h3>No archived reports</h3>
              <p>When you conduct comprehensive research reports on companies, they will be archived here.</p>
              <Link className="btn-primary" href="/">
                <Search size={14} />
                <span>Research a Company</span>
              </Link>
            </div>
          ) : (
            <div className="history-cards-grid">
              {reports.map((report) => (
                <article className="card history-card report-card" key={report.id}>
                  <div className="history-card-header">
                    <div className="history-card-badges">
                      <span className="history-time-badge">{relativeTime(report.createdAt)}</span>
                      <span className="ticker-badge primary">{report.ticker}</span>
                      <span className="exchange-badge">{report.exchange}</span>
                    </div>
                  </div>
                  <h3 className="history-card-title">{report.companyName}</h3>
                  <p className="history-card-snippet">{report.query}</p>
                  <div className="history-card-actions">
                    <Link className="btn-resume" href={`/history/${report.id}`}>
                      <span>View Dossier</span>
                      <ExternalLink size={13} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
