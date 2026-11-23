'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FileSearch,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { JaroLogo } from '@/components/brand/JaroLogo';
import { MarkdownAnswer } from './MarkdownAnswer';
import { TechnicalChart } from './TechnicalChart';
import { InvestmentDecisionCard } from './InvestmentDecisionCard';
import type { ResearchSourceMeta } from '@/types/research';
import type {
  ConversationArtifact,
  ConversationContext,
  ResearchIntent,
} from '@/types/conversation';
import { getMemoryEnabled, getMemoryIdentity } from '@/lib/memory/client';
import { AttachmentGallery } from './AttachmentGallery';
import { deleteAttachment, storeAttachment } from '@/lib/attachments/client-store';
import type { ImageAttachment } from '@/types/attachment';
import {
  formatMessageTime,
  dedupeMessageSources,
  replaceInternalCitations,
} from './types';
import { ThinkingPanel } from './ThinkingPanel';

interface SourceListProps {
  sources: ResearchSourceMeta[];
  open: boolean;
  onOpenChange: (value: boolean) => void;
  citationScope: string;
}

function SourceList({ sources, open, onOpenChange, citationScope }: SourceListProps) {
  return (
    <div className="source-list">
      <button className="source-list-toggle" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <ExternalLink size={12} /> Sources & References ({sources.length}) {open ? '−' : '+'}
      </button>
      {open && <div className="source-grid">{sources.map((source, index) => (
        <a href={source.url} id={`${citationScope}-source-${index + 1}`} target="_blank" rel="noopener noreferrer" key={source.url}>
          <span>[{index + 1}] {source.authority === 'high' ? 'Primary / official' : source.sourceType.replaceAll('_', ' ')}</span>
          <strong>{source.title || source.domain}</strong>
          <small>Publisher: {source.domain}</small>
          {source.publishedAt && <small>Published: {new Date(source.publishedAt).toLocaleDateString('en-IN')}</small>}
          <small>Retrieved: {new Date(source.retrievedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small>
          {source.supportedMetrics && source.supportedMetrics.length > 0 && <small>Used for: {source.supportedMetrics.slice(0, 6).join(', ')}</small>}
        </a>
      ))}</div>}
    </div>
  );
}

interface ArtifactSummaryProps {
  artifact: ConversationArtifact;
}

function ArtifactSummary({ artifact }: ArtifactSummaryProps) {
  if (artifact.kind === 'investment_decision') {
    return <InvestmentDecisionCard result={artifact.result} />;
  }
  if (artifact.kind === 'technical_analysis') {
    return <TechnicalChart initial={artifact.result} />;
  }
  if (artifact.kind === 'company_report') {
    const { name, ticker, exchange, sector, industry } = artifact.report.company;
    return (
      <div className="artifact-card company-report-card">
        <div className="artifact-heading">
          <div>
            <JaroLogo variant="compact" />
            <strong>{name}</strong>
          </div>
          <span className="badge-neutral">{ticker}</span>
        </div>
        <div className="artifact-meta">
          <span className="artifact-meta-item">
            <span className="artifact-meta-label">Sector</span>
            <span className="artifact-meta-value">{sector || '—'}</span>
          </span>
          {industry && (
            <span className="artifact-meta-item">
              <span className="artifact-meta-label">Industry</span>
              <span className="artifact-meta-value">{industry}</span>
            </span>
          )}
        </div>
        <div className="artifact-metrics">
          {artifact.metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (artifact.kind === 'screening') {
    return (
      <div className="artifact-card compact">
        <div className="artifact-heading"><div><FileSearch size={15} /><strong>{artifact.title}</strong></div><span>{artifact.matchedCount} matches / {artifact.universeSize} retrieved</span></div>
        <div className="filter-chips">{artifact.appliedFilters.map((filter) => <span key={filter}>{filter}</span>)}</div>
      </div>
    );
  }
  return (
    <div className="artifact-card compact">
      <div className="artifact-heading"><div><FileSearch size={15} /><strong>{artifact.title}</strong></div><span>{artifact.companies.length} companies</span></div>
    </div>
  );
}

interface MessageBubbleProps {
  message: import('./types').LocalMessage;
  copied: boolean;
  onCopy: () => void;
  onSuggestion: (value: string) => void;
  onRetry: () => void;
}

export function MessageBubble({ message, copied, onCopy, onSuggestion, onRetry }: MessageBubbleProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const numberedSources = dedupeMessageSources(message.sources ?? []);
  const citationScope = `message-${message.id}`;
  const renderedContent = replaceInternalCitations(message.content, numberedSources);
  const openCitation = useCallback((sourceNumber: number) => {
    setSourcesOpen(true);
  }, []);

  const isError = message.status === 'error';
  const isStreaming = message.status === 'streaming';

  if (message.role === 'user') {
    return (
      <div className="message-row user-message">
        <div className="user-message-content">
          {message.attachments && message.attachments.length > 0 && <AttachmentGallery attachments={message.attachments} />}
          <div className="user-bubble">{message.content}</div>
          <span className="message-time">{formatMessageTime(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`message-row assistant-message ${isError ? 'has-error' : ''} ${isStreaming ? 'is-streaming' : ''}`}>
      <div className="assistant-answer">
        {message.artifact && <ArtifactSummary artifact={message.artifact} />}

        {/* Thinking panel: show while streaming OR if stages exist (starts collapsed by default) */}
        {(isStreaming || (message.stages ?? []).length > 0) && (
          <ThinkingPanel
            stages={message.stages ?? []}
            sources={isStreaming ? [] : (message.sources ?? [])}
            isStreaming={isStreaming}
            startedAt={message.createdAt}
          />
        )}

        {/* Fallback spinner only if not streaming and no content/stages */}
        {!message.content && !isStreaming && (message.stages ?? []).length === 0 && (
          <div className="researching-state">
            <LoaderCircle size={18} className="animate-spin text-accent" />
            <div className="researching-text">
              <strong style={{ fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.02em', color: 'var(--text-primary)' }}>Thinking...</strong>
            </div>
          </div>
        )}

        {message.content ? (
          <MarkdownAnswer content={renderedContent} citationScope={`message-${message.id}`} onCitationClick={openCitation} />
        ) : null}
        {message.status === 'streaming' && message.content && (
          <div className="streaming-status"><span className="pulse-dot" /> Synthesizing research insights…</div>
        )}
        {isError && (
          <div className="message-error">
            <span>{message.error}</span>
            <button onClick={onRetry} className="retry-btn"><RefreshCw size={12} /> Retry</button>
          </div>
        )}
        {numberedSources.length > 0 && (
          <SourceList
            sources={numberedSources}
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
            citationScope={`message-${message.id}`}
          />
        )}
        {!isStreaming && message.content && !isError && (
          <div className="message-tools">
            <button
              onClick={onCopy}
              className={`message-action-btn ${copied ? 'copied' : ''}`}
              aria-label={copied ? 'Copied to clipboard' : 'Copy response'}
              title={copied ? 'Copied' : 'Copy'}
              type="button"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={onRetry}
              className="message-action-btn"
              aria-label="Retry question"
              title="Retry question"
              type="button"
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
            <span className="message-time"><Clock3 size={11} /> {formatMessageTime(message.createdAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}