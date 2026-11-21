'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Database, FileText, BarChart2, Newspaper, Globe, Sparkles } from 'lucide-react';
import type { MessageStage } from './types';
import type { ResearchSourceMeta } from '@/types/research';

// ─── Stage ID → human-readable step label ────────────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  understanding:         'Parsing your query',
  company_resolution:    'Resolving company identity',
  retrieval:             'Scanning financial databases and documents',
  fundamental_research:  'Running fundamental & valuation research',
  financial_enrichment:  'Enriching financial metrics',
  web_research:          'Scanning financial databases and documents',
  analysis:              'Synthesizing research insights',
  screening:             'Screening the equity universe',
  technical_screen:      'Running technical analysis filters',
  live_data:             'Fetching live market data',
  multi_timeframe:       'Analysing multi-timeframe candle data',
  market_regime:         'Evaluating market regime & sector context',
  decision:              'Building investment decision framework',
  decision_analysis:     'Calculating scores, entries & risk/reward',
  upstox_instrument:     'Resolving broker instrument keys',
  technical_data:        'Computing technical indicators',
  technical_calculation: 'Calculating EMA, RSI, MACD, ADX & more',
  backtest:              'Back-testing technical methodology',
};

// Stage-id prefix patterns for per-company stages (e.g. "SWIGGY_retrieval")
function resolveLabel(stageId: string, detail?: string): string {
  const lower = stageId.toLowerCase();
  for (const [key, label] of Object.entries(STAGE_LABELS)) {
    if (lower.endsWith(`_${key}`) || lower === key) {
      // Try to inject ticker prefix if stage is per-company
      const ticker = lower.endsWith(`_${key}`)
        ? stageId.slice(0, stageId.toLowerCase().lastIndexOf(`_${key}`)).toUpperCase()
        : null;
      if (ticker) return `${label} — ${ticker}`;
      return label;
    }
  }
  // If detail contains useful info, use it
  if (detail && detail.length < 80) return detail;
  return stageId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Detail line to show under a step
function resolveDetail(stageId: string, detail?: string): string | null {
  if (!detail) return null;
  // Don't repeat label as detail
  const label = STAGE_LABELS[stageId.toLowerCase()];
  if (label && detail === label) return null;
  return detail;
}

// ─── Source chip icon by sourceType ─────────────────────────────────────────
function SourceIcon({ type }: { type: ResearchSourceMeta['sourceType'] }) {
  const cls = 'thinking-source-icon';
  if (type === 'annual_report') return <FileText size={13} className={cls} />;
  if (type === 'investor_presentation') return <BarChart2 size={13} className={cls} />;
  if (type === 'exchange_filing') return <FileText size={13} className={cls} />;
  if (type === 'financial_database') return <Database size={13} className={cls} />;
  if (type === 'news') return <Newspaper size={13} className={cls} />;
  if (type === 'analysis') return <BarChart2 size={13} className={cls} />;
  return <Globe size={13} className={cls} />;
}

function sourceTypeLabel(type: ResearchSourceMeta['sourceType']): string {
  if (type === 'annual_report') return 'Annual Report';
  if (type === 'investor_presentation') return 'Investor Presentation';
  if (type === 'exchange_filing') return 'Exchange Filing';
  if (type === 'financial_database') return 'Database';
  if (type === 'news') return 'News';
  if (type === 'analysis') return 'Research';
  return 'Source';
}

// Extract a short subtitle for source chip (e.g. "ETERNAL · Q2 FY27")
function sourceSubtitle(source: ResearchSourceMeta): string {
  const parts: string[] = [];
  // Try to extract ticker/company from title
  const titleMatch = source.title?.match(/^([A-Z]{2,10}(?:\s+[A-Z]{2,10})?)\s*[–—-]/);
  if (titleMatch) parts.push(titleMatch[1].trim());
  else if (source.domain && source.domain !== 'exchange-data') parts.push(source.domain.replace('www.', '').split('.')[0].toUpperCase());
  // Try to extract period from title (e.g. "Q2 FY27", "FY26", "TTM")
  const periodMatch = source.title?.match(/\b(Q[1-4]\s*FY\d{2,4}|FY\d{2,4}|TTM|H[12]\s*FY\d{2,4})\b/i);
  if (periodMatch) parts.push(periodMatch[1].toUpperCase());
  return parts.join(' · ') || source.domain;
}

// ─── Main Component ──────────────────────────────────────────────────────────
interface ThinkingPanelProps {
  stages: MessageStage[];
  sources: ResearchSourceMeta[];
  isStreaming: boolean;
  startedAt: string; // ISO timestamp when assistant message was created
}

export function ThinkingPanel({ stages, sources, isStreaming, startedAt }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalElapsedRef = useRef<number>(0);

  // Count up timer while streaming; freeze on done
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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming, startedAt]);

  // When streaming ends, keep showing the final elapsed time
  const displayElapsed = isStreaming ? elapsed : finalElapsedRef.current;

  // Only show completed + running stages (skip failed silently, they appear in answer)
  const visibleStages = stages.filter((s) => s.status !== 'failed' || s.detail);

  if (visibleStages.length === 0 && sources.length === 0 && !isStreaming) return null;

  const hasRunning = stages.some((s) => s.status === 'running');

  return (
    <div className={`thinking-panel ${collapsed ? 'thinking-panel--collapsed' : ''} ${!isStreaming ? 'thinking-panel--done' : ''}`}>
      {/* Header */}
      <button
        className="thinking-panel-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        type="button"
      >
        <div className="thinking-panel-header-left">
          <Sparkles size={14} className="thinking-sparkle" />
          <span className="thinking-panel-title">
            {isStreaming && hasRunning ? 'Thinking' : 'Thought'}
            {displayElapsed > 0 && (
              <span className="thinking-elapsed"> for {displayElapsed.toFixed(1)}s</span>
            )}
          </span>
        </div>
        <div className="thinking-panel-header-right">
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="thinking-panel-body">
          {/* Step timeline placeholder if streaming starts before first stage */}
          {visibleStages.length === 0 && isStreaming && (
            <ol className="thinking-steps">
              <li className="thinking-step thinking-step--running">
                <span className="thinking-step-dot thinking-step-dot--pulse" aria-hidden="true" />
                <div className="thinking-step-content">
                  <span className="thinking-step-label">Initializing research pipeline...</span>
                </div>
              </li>
            </ol>
          )}

          {/* Step timeline */}
          {visibleStages.length > 0 && (
            <ol className="thinking-steps">
              {visibleStages.map((stage, idx) => {
                const label = resolveLabel(stage.id, stage.detail);
                const detail = resolveDetail(stage.id, stage.detail);
                return (
                  <li
                    key={`${stage.id}-${idx}`}
                    className={`thinking-step thinking-step--${stage.status}`}
                  >
                    <span className="thinking-step-dot" aria-hidden="true" />
                    <div className="thinking-step-content">
                      <span className="thinking-step-label">{label}</span>
                      {detail && detail !== label && (
                        <span className="thinking-step-detail">{detail}</span>
                      )}
                    </div>
                  </li>
                );
              })}
              {/* Animated placeholder for next incoming step */}
              {isStreaming && hasRunning && (
                <li className="thinking-step thinking-step--pending">
                  <span className="thinking-step-dot thinking-step-dot--pulse" aria-hidden="true" />
                  <div className="thinking-step-content">
                    <span className="thinking-step-label thinking-step-label--ghost">
                      <span className="thinking-ghost-bar" />
                    </span>
                  </div>
                </li>
              )}
            </ol>
          )}

          {/* Source chips */}
          {sources.length > 0 && (
            <div className="thinking-sources">
              {sources.map((src, idx) => (
                <a
                  key={src.id ?? idx}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="thinking-source-chip"
                  title={src.title}
                >
                  <SourceIcon type={src.sourceType} />
                  <div className="thinking-source-chip-text">
                    <span className="thinking-source-type">{sourceTypeLabel(src.sourceType)}</span>
                    <span className="thinking-source-sub">{sourceSubtitle(src)}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
