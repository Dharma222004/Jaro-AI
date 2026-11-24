'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Database, FileText, BarChart2, Newspaper, Globe } from 'lucide-react';
import { ThinkingBulbLogo } from '@/components/brand/ThinkingBulbLogo';
import type { MessageStage } from './types';
import type { ResearchSourceMeta } from '@/types/research';

// ─── Stage ID → user-friendly human status line ──────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  understanding:         'Understanding your question',
  company_resolution:    'Identifying the company',
  retrieval:             'Scanning financial databases and filings',
  fundamental_research:  'Retrieving fundamental financial metrics',
  financial_enrichment:  'Enriching financial data & ratios',
  web_research:          'Retrieving exchange records and filings',
  analysis:              'Analysing market information & valuation',
  screening:             'Screening equity universe',
  technical_screen:      'Running technical analysis indicators',
  live_data:             'Fetching live market data',
  multi_timeframe:       'Analysing multi-timeframe candle structure',
  market_regime:         'Evaluating market regime & sector strength',
  decision:              'Preparing investment research framework',
  decision_analysis:     'Calculating QTVT Confluence gates & risk/reward',
  upstox_instrument:     'Resolving exchange instrument keys',
  technical_data:        'Computing technical indicators',
  technical_calculation: 'Calculating EMA, RSI & ATR levels',
  backtest:              'Validating systematic strategy rules',
};

function resolveLabel(stageId: string, detail?: string): string {
  const lower = stageId.toLowerCase();
  for (const [key, label] of Object.entries(STAGE_LABELS)) {
    if (lower.endsWith(`_${key}`) || lower === key) {
      const ticker = lower.endsWith(`_${key}`)
        ? stageId.slice(0, stageId.toLowerCase().lastIndexOf(`_${key}`)).toUpperCase()
        : null;
      if (ticker) return `${label} (${ticker})`;
      return label;
    }
  }
  if (detail && detail.length < 80) return detail;
  return stageId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function SourceIcon({ type }: { type: ResearchSourceMeta['sourceType'] }) {
  const cls = 'thinking-source-icon';
  if (type === 'annual_report') return <FileText size={12} className={cls} />;
  if (type === 'investor_presentation') return <BarChart2 size={12} className={cls} />;
  if (type === 'exchange_filing') return <FileText size={12} className={cls} />;
  if (type === 'financial_database') return <Database size={12} className={cls} />;
  if (type === 'news') return <Newspaper size={12} className={cls} />;
  if (type === 'analysis') return <BarChart2 size={12} className={cls} />;
  return <Globe size={12} className={cls} />;
}

function sourceTypeLabel(type: ResearchSourceMeta['sourceType']): string {
  if (type === 'annual_report') return 'Annual Report';
  if (type === 'investor_presentation') return 'Presentation';
  if (type === 'exchange_filing') return 'Exchange Filing';
  if (type === 'financial_database') return 'Database';
  if (type === 'news') return 'News';
  if (type === 'analysis') return 'Research';
  return 'Source';
}

interface ThinkingPanelProps {
  stages: MessageStage[];
  sources: ResearchSourceMeta[];
  isStreaming: boolean;
  startedAt: string;
}

export function ThinkingPanel({ stages, sources, isStreaming, startedAt }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalElapsedRef = useRef<number>(0);

  useEffect(() => {
    if (isStreaming) {
      const start = new Date(startedAt).getTime();
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - start) / 1000;
        setElapsed(secs);
        finalElapsedRef.current = secs;
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isStreaming, startedAt]);

  const displayElapsed = isStreaming ? elapsed : finalElapsedRef.current;
  const visibleStages = stages.filter((s) => s.status !== 'failed' || s.detail);
  const activeStage = stages.findLast((s) => s.status === 'running') || visibleStages[visibleStages.length - 1];
  const activeLabel = activeStage ? resolveLabel(activeStage.id, activeStage.detail) : 'Preparing your research report';

  if (visibleStages.length === 0 && sources.length === 0 && !isStreaming) return null;

  return (
    <div className={`thinking-compact-container ${isStreaming ? 'is-processing' : 'is-complete'} ${collapsed ? 'is-collapsed' : 'is-expanded'}`}>
      <button
        className="thinking-compact-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        type="button"
        title={collapsed ? 'View research process details' : 'Collapse research process details'}
      >
        <div className="thinking-compact-left">
          <ThinkingBulbLogo size={13} pulse={isStreaming} />
          <span className="thinking-compact-status">
            <span className="thinking-done-text">Thought</span>
            {displayElapsed > 0 && (
              <span className="thinking-compact-time">
                {isStreaming ? `(${displayElapsed.toFixed(1)}s)` : `for ${displayElapsed.toFixed(1)}s`}
              </span>
            )}
            {!isStreaming && sources.length > 0 && (
              <span className="thinking-sources-badge">· {sources.length} sources</span>
            )}
          </span>
        </div>
        <div className="thinking-compact-right">
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </div>
      </button>

      {!collapsed && (
        <div className="thinking-compact-drawer">
          {visibleStages.length > 0 && (
            <ol className="thinking-mini-steps">
              {visibleStages.map((stage, idx) => {
                const label = resolveLabel(stage.id, stage.detail);
                return (
                  <li key={`${stage.id}-${idx}`} className={`thinking-mini-step step-${stage.status}`}>
                    <span className="step-bullet" aria-hidden="true" />
                    <span className="step-label">{label}</span>
                    {stage.detail && stage.detail !== label && (
                      <span className="step-subdetail">{stage.detail}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {sources.length > 0 && (
            <div className="thinking-mini-sources">
              <span className="sources-heading">Audited Sources:</span>
              <div className="sources-chip-row">
                {sources.map((src, idx) => (
                  <a
                    key={src.id ?? idx}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-mini-chip"
                    title={src.title || src.url}
                  >
                    <SourceIcon type={src.sourceType} />
                    <span>{src.domain?.replace(/^www\./, '') || sourceTypeLabel(src.sourceType)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
