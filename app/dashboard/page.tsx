'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Search,
  ArrowRight,
  ShieldAlert,
  Globe,
  BarChart3,
  MessageSquare,
  FileText,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { CompanyCandidate } from '@/types/company';
import type { ResearchReport, ResearchSourceMeta } from '@/types/research';
import { ResearchProgress } from '@/components/research/ResearchProgress';
import { DisambiguationModal } from '@/components/research/DisambiguationModal';
import { ReportView } from '@/components/research/ReportView';

type PageState =
  | { view: 'search' }
  | { view: 'ambiguous'; candidates: CompanyCandidate[]; query: string }
  | { view: 'loading'; query: string; stages: StageItem[] }
  | { view: 'report'; researchId: string; report: ResearchReport; sources: ResearchSourceMeta[] }
  | { view: 'error'; message: string; query: string };

export interface StageItem {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
}

const INITIAL_STAGES: StageItem[] = [
  { id: 'company_id', label: 'Query intent & NSE/BSE entity resolution', status: 'pending' },
  { id: 'web_research', label: 'Live web search & multi-source news collection', status: 'pending' },
  { id: 'metric_extraction', label: 'Financial statements, valuation & technical extraction', status: 'pending' },
  { id: 'validation', label: 'Cross-source validation & conflict audit', status: 'pending' },
  { id: 'ai_analysis', label: 'Synthesizing Institutional Report & Analyst Chat Briefing', status: 'pending' },
  { id: 'report_validation', label: 'Finalizing 6-pillar scorecard & grounded citations', status: 'pending' },
];

const QUICK_ANALYST_QUERIES = [
  {
    ticker: 'RELIANCE',
    label: 'Reliance Industries: Fundamentals, technical levels & latest news',
    query: 'Analyze Reliance Industries fundamentals, valuation, technical support/resistance and latest news',
  },
  {
    ticker: 'HAL',
    label: 'Hindustan Aeronautics: Order book, ROE & analyst recommendation',
    query: 'Deep research on Hindustan Aeronautics (HAL) defense order book, fundamentals, technicals and recommendation',
  },
  {
    ticker: 'TCS',
    label: 'TCS: Earnings trajectory, margins, P/E valuation & technicals',
    query: 'TCS latest quarterly performance, operating margins, valuation ratios and technical outlook',
  },
  {
    ticker: 'ETERNAL',
    label: 'Zomato (Eternal): Quick commerce growth, profitability & target price',
    query: 'Zomato Blinkit growth, fundamental valuation, latest analyst target price and technical structure',
  },
  {
    ticker: 'HDFCBANK',
    label: 'HDFC Bank: NIM trend, deposit growth, valuation & technicals',
    query: 'HDFC Bank fundamental analysis, NIM and credit growth, valuation vs historical average and technical levels',
  },
  {
    ticker: 'TATAMOTORS',
    label: 'Tata Motors: EV & JLR outlook, debt profile & valuation',
    query: 'Tata Motors JLR and EV fundamentals, free cash flow, debt reduction and technical momentum',
  },
];

export default function DashboardPage() {
  const [query, setQuery] = useState('');
  const [pageState, setPageState] = useState<PageState>({ view: 'search' });
  const inputRef = useRef<HTMLInputElement>(null);

  const updateStage = useCallback(
    (
      stages: StageItem[],
      stageId: string,
      status: StageItem['status'],
      label?: string,
      detail?: string
    ): StageItem[] => {
      let found = false;
      const updated = stages.map((s) => {
        if (s.id === stageId) {
          found = true;
          return {
            ...s,
            status,
            ...(label ? { label } : {}),
            ...(detail !== undefined ? { detail } : {}),
          };
        }
        return s;
      });
      if (!found && label) {
        return [...updated, { id: stageId, label, status, detail }];
      }
      return updated;
    },
    []
  );

  const runResearch = useCallback(
    async (q: string, preResolvedCompany?: CompanyCandidate) => {
      const trimmed = q.trim();
      if (!trimmed) return;

      let currentStages = INITIAL_STAGES.map((s) => ({ ...s }));
      setPageState({ view: 'loading', query: trimmed, stages: currentStages });

      try {
        const body: Record<string, unknown> = {
          query: trimmed,
          stream: true,
        };
        if (preResolvedCompany) {
          body.company = preResolvedCompany;
        }

        const res = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream') && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const chunk of lines) {
              const trimmedChunk = chunk.trim();
              if (!trimmedChunk.startsWith('data:')) continue;
              const jsonStr = trimmedChunk.replace(/^data:\s*/, '');
              try {
                const event = JSON.parse(jsonStr);

                if (event.type === 'stage') {
                  currentStages = updateStage(
                    currentStages,
                    event.stage,
                    event.status,
                    event.label,
                    event.detail
                  );
                  setPageState({ view: 'loading', query: trimmed, stages: [...currentStages] });
                } else if (event.type === 'ambiguous') {
                  setPageState({
                    view: 'ambiguous',
                    candidates: event.candidates,
                    query: trimmed,
                  });
                  return;
                } else if (event.type === 'unresolved' || event.type === 'error') {
                  setPageState({
                    view: 'error',
                    message: event.error || "We couldn't identify this company.",
                    query: trimmed,
                  });
                  return;
                } else if (event.type === 'complete') {
                  const data = event.data;
                  currentStages = currentStages.map((s) => ({ ...s, status: 'completed' as const }));
                  setPageState({ view: 'loading', query: trimmed, stages: [...currentStages] });

                  await new Promise((r) => setTimeout(r, 350));

                  setPageState({
                    view: 'report',
                    researchId: data.researchId,
                    report: data.report,
                    sources: data.sources ?? [],
                  });
                  return;
                }
              } catch {
                /* ignore partial chunks */
              }
            }
          }
        } else {
          const data = await res.json();
          if (data.status === 'ambiguous') {
            setPageState({ view: 'ambiguous', candidates: data.candidates, query: trimmed });
            return;
          }
          if (data.status === 'unresolved' || data.status === 'failed' || !res.ok) {
            setPageState({
              view: 'error',
              message: data.error ?? 'Research could not be completed.',
              query: trimmed,
            });
            return;
          }

          setPageState({
            view: 'report',
            researchId: data.researchId,
            report: data.report,
            sources: data.sources ?? [],
          });
        }
      } catch {
        setPageState({
          view: 'error',
          message: 'Connection error. Please check your network and try again.',
          query: trimmed,
        });
      }
    },
    [updateStage]
  );

  const handleSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setQuery('');
    runResearch(q);
  }, [query, runResearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleDisambiguate = (candidate: CompanyCandidate) => {
    const q = pageState.view === 'ambiguous' ? pageState.query : query;
    setPageState({ view: 'search' });
    runResearch(q, candidate);
  };

  const handleBack = () => {
    setPageState({ view: 'search' });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleRefresh = async () => {
    if (pageState.view !== 'report') return;
    const report = pageState.report;
    if (!report) return;

    const q = report.queryAsked || `Analyse ${report.company.name}`;
    setQuery('');
    runResearch(q);
  };

  if (pageState.view === 'loading') {
    return (
      <ResearchProgress
        query={pageState.query}
        stages={pageState.stages}
      />
    );
  }

  if (pageState.view === 'ambiguous') {
    return (
      <DisambiguationModal
        query={pageState.query}
        candidates={pageState.candidates}
        onSelect={handleDisambiguate}
        onCancel={handleBack}
      />
    );
  }

  if (pageState.view === 'report') {
    return (
      <ReportView
        report={pageState.report}
        sources={pageState.sources}
        researchId={pageState.researchId}
        onBack={handleBack}
        onRefresh={handleRefresh}
      />
    );
  }

  if (pageState.view === 'error') {
    return (
      <ErrorState
        message={pageState.message}
        query={pageState.query}
        onRetry={() => runResearch(pageState.query)}
        onBack={handleBack}
      />
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div
        className="page-container"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingTop: '2.5rem',
          paddingBottom: '2.5rem',
        }}
      >
        <div style={{ maxWidth: '820px', margin: '0 auto', width: '100%' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.3rem 0.75rem',
                borderRadius: '6px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.73rem',
                fontWeight: 700,
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '1rem',
              }}
            >
              <Sparkles size={13} />
              <span>Deep Equity Research + Live Web-Grounded Analyst Chat</span>
            </div>

            <h1
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--text-primary)',
                lineHeight: 1.18,
                marginBottom: '0.75rem',
              }}
            >
              Ask anything about a stock, fundamentals, technicals, or latest news
            </h1>
            <p
              style={{
                fontSize: '0.94rem',
                color: 'var(--text-secondary)',
                maxWidth: '640px',
                margin: '0 auto',
                lineHeight: 1.55,
              }}
            >
              Jaro AI understands your query, searches live financial web sources &amp; market data, and delivers both an{' '}
              <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Institutional Equity Dossier</strong> and a{' '}
              <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Conversational Analyst Reply</strong> side-by-side so you can keep asking follow-ups.
            </p>
          </div>

          {/* Search Bar */}
          <div className="search-wrapper" style={{ marginBottom: '1.5rem' }}>
            <div className="search-icon-pos">
              <Search size={19} strokeWidth={2.4} />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any stock, ticker, fundamentals, technicals, or news (e.g., 'Reliance valuation & latest news')..."
              className="search-input-field"
              autoFocus
            />
            <div className="search-button-pos">
              <button
                onClick={handleSearch}
                disabled={!query.trim()}
                className="btn-gradient"
              >
                <span>Analyze</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {/* Pipeline Workflow Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: '0.65rem',
              marginBottom: '2rem',
            }}
          >
            <div
              style={{
                padding: '0.75rem 0.9rem',
                borderRadius: '8px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
              }}
            >
              <Globe size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  1. Live Web Search
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '2px' }}>
                  Latest filings, earnings concalls, analyst target prices &amp; breaking news.
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '0.75rem 0.9rem',
                borderRadius: '8px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
              }}
            >
              <BarChart3 size={16} style={{ color: 'var(--positive)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  2. Fundamentals &amp; Technicals
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '2px' }}>
                  P/E, ROE, ROCE, 6-pillar scorecard, 50/200 DMA, RSI &amp; support/resistance.
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '0.75rem 0.9rem',
                borderRadius: '8px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
              }}
            >
              <FileText size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  3. Full Analyst Dossier
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '2px' }}>
                  Bull vs. Bear thesis, conviction score, valuation matrix &amp; risk audit.
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '0.75rem 0.9rem',
                borderRadius: '8px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
              }}
            >
              <MessageSquare size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  4. Interactive Analyst Chat
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '2px' }}>
                  Direct chatbot answer + continuous web-grounded follow-up Q&amp;A.
                </div>
              </div>
            </div>
          </div>

          {/* Quick-Start Institutional Queries */}
          <div>
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: 'var(--text-muted)',
                marginBottom: '0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <TrendingUp size={13} style={{ color: 'var(--accent)' }} />
              <span>Try an Institutional Deep-Dive Query</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '0.55rem',
              }}
            >
              {QUICK_ANALYST_QUERIES.map((item) => (
                <button
                  key={item.ticker}
                  onClick={() => runResearch(item.query)}
                  style={{
                    textAlign: 'left',
                    padding: '0.7rem 0.85rem',
                    borderRadius: '8px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease, background 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: 'var(--accent)',
                      }}
                    >
                      NSE: {item.ticker}
                    </span>
                    <ArrowRight size={12} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.35,
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  query,
  onRetry,
  onBack,
}: {
  message: string;
  query: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '2rem', textAlign: 'center' }}>
        <div
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            margin: '0 auto 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--negative-dim)',
            color: 'var(--negative)',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          <ShieldAlert size={22} />
        </div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          Research Could Not Be Completed
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '0.5rem' }}>
          {message}
        </p>
        <p
          style={{
            fontSize: '0.78rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            padding: '0.3rem 0.6rem',
            borderRadius: '4px',
            background: 'var(--bg-elevated)',
            display: 'inline-block',
            marginBottom: '1.5rem',
          }}
        >
          Query: &ldquo;{query}&rdquo;
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button onClick={onBack} className="btn-secondary">
            ← Back
          </button>
          <button onClick={onRetry} className="btn-gradient">
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
