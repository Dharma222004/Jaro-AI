'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, RefreshCw, Filter, Bot, NotebookTabs } from 'lucide-react';
import { getMemoryIdentity, memoryAuthorization } from '@/lib/memory/client';
import type { MemoryType } from '@/types/memory';

const TYPES: MemoryType[] = ['working', 'episodic', 'semantic', 'procedural', 'profile', 'project'];

interface SearchResult {
  id: string;
  source: 'memory' | 'journal';
  type: string;
  title: string;
  summary: string;
  relevance: number;
  recency: number;
  importance: number;
  createdAt: string;
  updatedAt: string;
  entities: string[];
  metadata?: Record<string, unknown>;
}

export default function MemorySearchPage() {
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<MemoryType[]>([]);
  const [includeJournal, setIncludeJournal] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const identity = getMemoryIdentity();
      const params = new URLSearchParams({ q: query, limit: '20' });
      types.forEach((t) => params.append('types', t));
      if (includeJournal) params.append('includeJournal', '1');

      const response = await fetch(`/api/memory/search?${params}`, {
        headers: memoryAuthorization(identity),
        cache: 'no-store',
      });

      if (!response.ok) {
        const err = await response.json();
        setError(err.error || 'Search failed.');
        return;
      }

      const data = await response.json();
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, [query, types, includeJournal]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const relevanceBadge = (value: number) => {
    if (value >= 0.7) return 'text-positive';
    if (value >= 0.4) return 'text-warning';
    return 'text-negative';
  };

  return (
    <div className="page-container py-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-primary">Memory &amp; Journal Search</h1>
          <p className="text-muted text-sm">
            Semantic-equivalent retrieval across saved memories and shadow journal signals. Lexical overlap, entity matching, and recency weighting surface the most relevant context.
          </p>
        </header>

        <div className="card p-5 mb-6">
          <div className="flex flex-col lg:flex-row gap-4 items-end">
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-muted mb-1">Search query</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  className="input pl-10"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                  placeholder="e.g. GAIL swing trade setup, Q3 earnings, risk policy"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={search}
                disabled={loading || !query.trim()}
                className="btn-primary px-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />} Search
              </button>
              <button
                onClick={() => setIncludeJournal((v) => !v)}
                className="btn-ghost"
                aria-pressed={includeJournal}
                title="Include shadow journal signals"
              >
                <NotebookTabs size={16} />
              </button>
              <button
                className="btn-ghost"
                title="Filter by memory type (chips below)"
              >
                <Filter size={16} />
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs text-muted">Types:</span>
            {TYPES.map((t) => {
              const selected = types.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => {
                    setTypes((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                    );
                  }}
                  className={`text-xs px-2 py-1 rounded border ${
                    selected
                      ? 'bg-accent text-primary border-accent'
                      : 'bg-surface text-muted border-border-default'
                  }`}
                >
                  {t}
                </button>
              );
            })}
            {includeJournal && (
              <span className="text-xs text-muted flex items-center gap-1">
                <Bot size={12} className="text-accent" /> Journal included
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded bg-negative-dim text-negative text-xs border border-negative/20">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary">Results ({results.length})</h2>
            <span className="text-xs text-muted">Lexical + entity + recency scoring</span>
          </div>

          {results.length === 0 && !loading && !error && (
            <div className="card p-8 text-center">
              <p className="text-muted">No matching memories or journal signals found.</p>
              <p className="text-xs text-muted mt-2">Try a broader query or check your saved context.</p>
            </div>
          )}

          {results.map((result) => (
            <div key={result.id} className="card p-4 border-l-2">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                        result.source === 'memory'
                          ? 'bg-accent-dim text-accent border border-accent/30'
                          : 'bg-negative-dim text-negative border border-negative/30'
                      }`}
                    >
                      {result.source === 'memory' ? 'MEMORY' : 'JOURNAL'}
                    </span>
                    <span className="text-[10px] text-muted">{result.type}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-primary">{result.title}</h3>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-mono font-bold ${relevanceBadge(result.relevance)}`}>
                    {(result.relevance * 100).toFixed(0)}% match
                  </div>
                  <div className="text-[10px] text-muted">Relevance</div>
                </div>
              </div>
              <p className="text-sm text-secondary mb-2">{result.summary}</p>
              <div className="flex gap-2 text-xs text-muted mb-2">
                <span>{result.entities.join(', ') || '—'}</span>
                <span>{new Date(result.updatedAt).toLocaleDateString('en-IN')}</span>
                <span className={`text-[${relevanceBadge(result.relevance)}]`}>
                  {result.relevance >= 0.7 ? 'High relevance' : result.relevance >= 0.4 ? 'Moderate relevance' : 'Low relevance'}
                </span>
              </div>
              {result.metadata && (
                <details className="text-xs text-muted mt-2 border border-border-default/50 rounded p-2">
                  <summary className="cursor-pointer">Metadata</summary>
                  <pre className="mt-1 text-[10px] font-mono overflow-x-auto">{JSON.stringify(result.metadata, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
