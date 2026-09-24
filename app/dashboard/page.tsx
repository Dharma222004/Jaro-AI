'use client';

import { useState, useRef, useCallback } from 'react';
import { Search, ArrowRight, ShieldAlert } from 'lucide-react';
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
  { id: 'company_id', label: 'Company identification & NSE/BSE resolution', status: 'pending' },
  { id: 'web_research', label: 'Multi-source research collection', status: 'pending' },
  { id: 'metric_extraction', label: 'Financial statements & ratio extraction', status: 'pending' },
  { id: 'validation', label: 'Cross-source validation & conflict audit', status: 'pending' },
  { id: 'ai_analysis', label: 'Jaro AI is Analyzing & Synthesizing Financials', status: 'pending' },
  { id: 'report_validation', label: 'Report finalization & quality verification', status: 'pending' },
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

                  await new Promise((r) => setTimeout(r, 400));

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
      } catch (err) {
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

  // Clean, Unopinionated Research Terminal View (No recommendations)
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="page-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', width: '100%' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <h1
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--text-primary)',
                lineHeight: 1.2,
              }}
            >
              What company would you like to research?
            </h1>
          </div>

          {/* Clean Search Bar */}
          <div className="search-wrapper">
            <div className="search-icon-pos">
              <Search size={19} strokeWidth={2.4} />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search company or NSE ticker..."
              className="search-input-field"
              autoFocus
            />
            <div className="search-button-pos">
              <button
                onClick={handleSearch}
                disabled={!query.trim()}
                className="btn-gradient"
              >
                <span>Research</span>
                <ArrowRight size={14} />
              </button>
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
