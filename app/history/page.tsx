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
  Plus,
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
          // Only show conversations that have at least one message or a custom title
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
    if (!window.confirm('Delete all saved research conversations from this browser?')) return;
    setConversations([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CURRENT_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="page-container section-page">
      <header className="section-page-header">
        <span className="section-eyebrow">Research Workspace</span>
        <div className="section-header-row">
          <div>
            <h1>Research History</h1>
            <p>Review past equity research conversations and archived company dossiers.</p>
          </div>
          <Link className="btn-primary" href="/?new=1">
            <Plus size={15} strokeWidth={2.4} />
            <span>New Chat</span>
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <div className="history-tabs" role="tablist" aria-label="History sections">
        <button
          role="tab"
          aria-selected={activeTab === 'conversations'}
          className={`history-tab ${activeTab === 'conversations' ? 'active' : ''}`}
          onClick={() => setActiveTab('conversations')}
        >
          <MessageSquare size={15} />
          <span>Conversations ({conversations.length})</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'reports'}
          className={`history-tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <FileText size={15} />
          <span>Archived Reports ({reports.length})</span>
        </button>
      </div>

      {activeTab === 'conversations' ? (
        <section aria-labelledby="conversations-heading">
          <div className="history-section-header">
            <h2 id="conversations-heading" className="sr-only">Saved Conversations</h2>
            {conversations.length > 0 && (
              <button
                className="btn-ghost-danger"
                onClick={clearAllConversations}
                title="Clear all saved conversations"
                type="button"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {!hydrated ? (
            <div className="history-skeleton">
              <div className="skeleton-row" />
              <div className="skeleton-row" />
              <div className="skeleton-row" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="card empty-state">
              <span className="empty-state-icon"><Clock3 size={23} strokeWidth={2} /></span>
              <h2>No conversations yet</h2>
              <p>Your equity research dialogues, questions, and decisions will be safely preserved here.</p>
              <Link className="btn-primary" href="/">
                <Search size={15} />
                <span>Start Research</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="history-list">
              {conversations.map((conv) => {
                const activeTickers = conv.context?.activeCompanies?.map((c) => c.ticker) ?? [];
                return (
                  <div className="history-item-card card" key={conv.id}>
                    <div className="history-item-main">
                      <div className="history-item-meta">
                        <span className="history-time">{relativeTime(conv.updatedAt)}</span>
                        <span className="history-pill">{conv.messages.length} messages</span>
                        {activeTickers.map((ticker) => (
                          <span className="ticker-badge" key={ticker}>{ticker}</span>
                        ))}
                      </div>
                      <h3 className="history-item-title">{conv.title || 'Untitled Research'}</h3>
                      {conv.messages[0] && (
                        <p className="history-item-preview">
                          {conv.messages[0].content.slice(0, 160)}...
                        </p>
                      )}
                    </div>
                    <div className="history-item-actions">
                      <button
                        className="btn-secondary"
                        onClick={() => openConversation(conv.id)}
                        title="Resume this conversation in chat"
                        type="button"
                      >
                        <MessageSquare size={14} />
                        <span>Resume</span>
                      </button>
                      <button
                        className="icon-button danger"
                        onClick={() => deleteConversation(conv.id)}
                        aria-label="Delete conversation"
                        title="Delete conversation"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section aria-labelledby="reports-heading">
          <h2 id="reports-heading" className="sr-only">Archived Reports</h2>
          {reportsLoading ? (
            <div className="history-skeleton">
              <div className="skeleton-row" />
              <div className="skeleton-row" />
              <div className="skeleton-row" />
            </div>
          ) : reports.length === 0 ? (
            <div className="card empty-state">
              <span className="empty-state-icon"><FileText size={23} strokeWidth={2} /></span>
              <h2>No archived reports found</h2>
              <p>Full institutional equity reports generated during deep-dive research will appear here.</p>
              <Link className="btn-primary" href="/">
                <Search size={15} />
                <span>Launch New Analysis</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="history-list">
              {reports.map((report) => (
                <div className="history-item-card card" key={report.id}>
                  <div className="history-item-main">
                    <div className="history-item-meta">
                      <span className="ticker-badge">{report.exchange}: {report.ticker}</span>
                      <span className="badge-neutral">{new Date(report.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
                      <span className={`status-pill ${report.status}`}>{report.status}</span>
                    </div>
                    <h3 className="history-item-title">{report.companyName}</h3>
                    <p className="history-item-preview">Query: “{report.query}”</p>
                  </div>
                  <div className="history-item-actions">
                    <Link
                      className="btn-secondary"
                      href={`/history/${report.id}`}
                      title="View full report"
                    >
                      <ExternalLink size={14} />
                      <span>View Dossier</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
