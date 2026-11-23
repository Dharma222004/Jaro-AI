'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  BrainCircuit,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import type { MemoryRecordData, MemoryType } from '@/types/memory';
import { getMemoryEnabled, getMemoryIdentity, memoryAuthorization, setMemoryEnabled } from '@/lib/memory/client';

type ActiveTab = 'in_context' | 'episodic' | 'long_term' | 'documents';

interface EpisodicItem {
  id: string;
  conversationId?: string | null;
  eventType: string;
  title: string;
  summary: string;
  entities: string[];
  documentIds: string[];
  outcome?: string | null;
  importance: number;
  confidence: number;
  eventTimestamp: string;
}

interface LongTermItem {
  id: string;
  category: 'semantic' | 'procedural' | 'preference' | 'project';
  memoryKey?: string | null;
  title: string;
  value: string;
  summary: string;
  sourceType?: string | null;
  confidence: number;
  importance: number;
  sensitivity: string;
  status: string;
  version: number;
  updatedAt: string;
}

interface DocumentItem {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize?: number | null;
  documentCategory: string;
  publicationDate?: string | null;
  reportingPeriod?: string | null;
  reportingBasis?: string | null;
  ingestionStatus: string;
  ingestionError?: string | null;
  pageCount?: number | null;
  chunkCount?: number | null;
  version: number;
  createdAt: string;
}

interface RetrievedChunkPreview {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  contentType: string;
  pageNumber?: number | null;
  sectionTitle?: string | null;
  score: number;
}

export default function MemoryPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('in_context');
  const [enabled, setEnabledState] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Tab 1: In-Context (Working Memories)
  const [workingMemories, setWorkingMemories] = useState<MemoryRecordData[]>([]);

  // Tab 2: Episodic Memories
  const [episodes, setEpisodes] = useState<EpisodicItem[]>([]);
  const [episodeTypeFilter, setEpisodeTypeFilter] = useState<string>('all');

  // Tab 3: Long-Term Memories
  const [ltmList, setLtmList] = useState<LongTermItem[]>([]);
  const [ltmCategoryFilter, setLtmCategoryFilter] = useState<string>('all');
  const [newLtmCategory, setNewLtmCategory] = useState<'semantic' | 'procedural' | 'preference' | 'project'>('preference');
  const [newLtmTitle, setNewLtmTitle] = useState('');
  const [newLtmValue, setNewLtmValue] = useState('');

  // Tab 4: Documents (RAG)
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('annual_report');
  const [uploadPeriod, setUploadPeriod] = useState('');
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [searchedChunks, setSearchedChunks] = useState<RetrievedChunkPreview[]>([]);
  const [isSearchingDocs, setIsSearchingDocs] = useState(false);

  // Status message toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Loaders ──────────────────────────────────────────────────────
  const loadInContext = useCallback(async () => {
    const identity = getMemoryIdentity();
    const res = await fetch('/api/memory?type=working', {
      headers: memoryAuthorization(identity),
      cache: 'no-store',
    });
    const data = await res.json();
    setWorkingMemories(Array.isArray(data.memories) ? data.memories : []);
  }, []);

  const loadEpisodes = useCallback(async () => {
    const identity = getMemoryIdentity();
    const query = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '';
    const typeFilter = episodeTypeFilter !== 'all' ? `&eventType=${episodeTypeFilter}` : '';
    const res = await fetch(`/api/memory/episodes?limit=50${query}${typeFilter}`, {
      headers: memoryAuthorization(identity),
      cache: 'no-store',
    });
    const data = await res.json();
    setEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
  }, [searchQuery, episodeTypeFilter]);

  const loadLongTerm = useCallback(async () => {
    const identity = getMemoryIdentity();
    const query = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '';
    const catFilter = ltmCategoryFilter !== 'all' ? `&category=${ltmCategoryFilter}` : '';
    const res = await fetch(`/api/memory/long-term?limit=50${query}${catFilter}`, {
      headers: memoryAuthorization(identity),
      cache: 'no-store',
    });
    const data = await res.json();
    setLtmList(Array.isArray(data.memories) ? data.memories : []);
  }, [searchQuery, ltmCategoryFilter]);

  const loadDocuments = useCallback(async () => {
    const identity = getMemoryIdentity();
    const res = await fetch('/api/documents', {
      headers: memoryAuthorization(identity),
      cache: 'no-store',
    });
    const data = await res.json();
    setDocuments(Array.isArray(data.documents) ? data.documents : []);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'in_context') await loadInContext();
      else if (activeTab === 'episodic') await loadEpisodes();
      else if (activeTab === 'long_term') await loadLongTerm();
      else if (activeTab === 'documents') await loadDocuments();
    } catch {
      showToast('Failed to load memory data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, loadInContext, loadEpisodes, loadLongTerm, loadDocuments]);

  useEffect(() => {
    setEnabledState(getMemoryEnabled());
    void refreshAll();
  }, [refreshAll]);

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabledState(next);
    setMemoryEnabled(next);
    showToast(next ? 'Memory system enabled.' : 'Memory system paused.');
  };

  // ── Actions: Tab 2 (Episodic) ────────────────────────────────────
  const deleteEpisodeItem = async (id: string) => {
    if (!confirm('Delete this episodic event?')) return;
    const identity = getMemoryIdentity();
    await fetch(`/api/memory/episodes?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: memoryAuthorization(identity),
    });
    setEpisodes((prev) => prev.filter((e) => e.id !== id));
    showToast('Episodic event deleted.');
  };

  // ── Actions: Tab 3 (Long-Term) ───────────────────────────────────
  const createLongTermItem = async () => {
    if (!newLtmTitle.trim() || !newLtmValue.trim()) {
      showToast('Title and value are required.', 'error');
      return;
    }
    const identity = getMemoryIdentity();
    const res = await fetch('/api/memory/long-term', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...memoryAuthorization(identity) },
      body: JSON.stringify({
        category: newLtmCategory,
        title: newLtmTitle.trim(),
        value: newLtmValue.trim(),
        sourceType: 'user_explicit',
      }),
    });
    if (res.ok) {
      setNewLtmTitle('');
      setNewLtmValue('');
      await loadLongTerm();
      showToast('Long-term memory saved.');
    } else {
      showToast('Failed to save long-term memory.', 'error');
    }
  };

  const deleteLongTermItem = async (id: string) => {
    if (!confirm('Delete this durable knowledge record?')) return;
    const identity = getMemoryIdentity();
    await fetch(`/api/memory/long-term?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: memoryAuthorization(identity),
    });
    setLtmList((prev) => prev.filter((m) => m.id !== id));
    showToast('Record deleted.');
  };

  // ── Actions: Tab 4 (Documents) ──────────────────────────────────
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const identity = getMemoryIdentity();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));
    formData.append('category', uploadCategory);
    if (uploadPeriod) formData.append('reportingPeriod', uploadPeriod);

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: memoryAuthorization(identity),
        body: formData,
      });
      if (res.ok) {
        showToast(`Document "${file.name}" uploaded and queued for indexing!`);
        await loadDocuments();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to ingest document.', 'error');
      }
    } catch {
      showToast('Document upload error.', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteDocItem = async (id: string) => {
    if (!confirm('Delete this document and all its indexed chunks?')) return;
    const identity = getMemoryIdentity();
    await fetch(`/api/documents?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: memoryAuthorization(identity),
    });
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    showToast('Document deleted.');
  };

  const runDocSearch = async () => {
    if (!docSearchQuery.trim()) return;
    setIsSearchingDocs(true);
    try {
      const identity = getMemoryIdentity();
      const res = await fetch('/api/documents/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...memoryAuthorization(identity) },
        body: JSON.stringify({ query: docSearchQuery.trim(), topK: 6 }),
      });
      const data = await res.json();
      setSearchedChunks(Array.isArray(data.chunks) ? data.chunks : []);
    } catch {
      showToast('Document search failed.', 'error');
    } finally {
      setIsSearchingDocs(false);
    }
  };

  // ── Cloud Backup & Migration Export/Import ──────────────────────
  const handleExport = async () => {
    const identity = getMemoryIdentity();
    const res = await fetch('/api/memory/export', { headers: memoryAuthorization(identity) });
    if (!res.ok) {
      showToast('Export failed.', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jaro_memory_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded successfully.');
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const identity = getMemoryIdentity();
      const res = await fetch('/api/memory/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...memoryAuthorization(identity) },
        body: JSON.stringify(pkg),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Memory package imported successfully!');
        await refreshAll();
      } else {
        showToast(`Import error: ${data.errors?.[0] || 'Unknown'}`, 'error');
      }
    } catch {
      showToast('Invalid backup file JSON.', 'error');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  return (
    <div className="page-container memory-page" style={{ maxWidth: '1080px', margin: '0 auto' }}>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            zIndex: 9999,
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            backgroundColor: toast.type === 'success' ? '#059669' : '#dc2626',
            color: '#fff',
            fontSize: '0.82rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="section-page-header memory-page-header">
        <span className="section-eyebrow">Production Intelligence Layer</span>
        <h1 className="memory-page-title">Memory &amp; Document Intelligence</h1>
        <p className="memory-page-desc">
          Persistent 3-tier memory architecture (In-Context, Episodic, Long-Term) and document knowledge base (RAG).
        </p>
      </header>

      {/* Top Controls Toolbar */}
      <div className="card memory-status-card">
        <div className="memory-status-info">
          <BrainCircuit size={22} className="text-accent" />
          <div>
            <strong className="memory-status-title">
              Memory System: {enabled ? 'Active' : 'Disabled'}
            </strong>
            <span className="memory-status-note">
              {enabled ? 'Verified ground context & document retrieval connected' : 'Memory injection paused for research'}
            </span>
          </div>
        </div>

        <div className="memory-action-buttons-grid">
          <button
            type="button"
            className="btn btn-secondary memory-action-btn"
            onClick={toggleEnabled}
          >
            {enabled ? 'Disable' : 'Enable'}
          </button>

          <button
            type="button"
            className="btn btn-secondary memory-action-btn"
            onClick={handleExport}
            title="Download full JSON backup of memories and documents"
          >
            <Download size={13} />
            <span>Export Backup</span>
          </button>

          <label
            className="btn btn-secondary memory-action-btn memory-restore-label"
          >
            <Upload size={13} />
            <span>Restore Backup</span>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
          </label>

          <button
            type="button"
            className="btn btn-secondary memory-action-btn"
            onClick={refreshAll}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 4-Tier Navigation Tabs — Adaptive 2-col on mobile, 4-col on desktop */}
      <div className="memory-categories-grid" role="tablist" aria-label="Memory categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'in_context'}
          onClick={() => { setActiveTab('in_context'); setSearchQuery(''); }}
          className={`memory-category-card ${activeTab === 'in_context' ? 'is-active' : ''}`}
        >
          <div className="category-card-top">
            <Layers size={17} className="category-icon" />
            <span className="category-count">{workingMemories.length}</span>
          </div>
          <span className="category-title">In-Context Memory</span>
          <span className="category-desc">Active session context</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'episodic'}
          onClick={() => { setActiveTab('episodic'); setSearchQuery(''); }}
          className={`memory-category-card ${activeTab === 'episodic' ? 'is-active' : ''}`}
        >
          <div className="category-card-top">
            <Clock size={17} className="category-icon" />
            <span className="category-count">{episodes.length}</span>
          </div>
          <span className="category-title">Episodic Memory</span>
          <span className="category-desc">Task &amp; trade episodes</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'long_term'}
          onClick={() => { setActiveTab('long_term'); setSearchQuery(''); }}
          className={`memory-category-card ${activeTab === 'long_term' ? 'is-active' : ''}`}
        >
          <div className="category-card-top">
            <Sparkles size={17} className="category-icon" />
            <span className="category-count">{ltmList.length}</span>
          </div>
          <span className="category-title">Long-Term Memory</span>
          <span className="category-desc">Rules &amp; preferences</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'documents'}
          onClick={() => { setActiveTab('documents'); setSearchQuery(''); }}
          className={`memory-category-card ${activeTab === 'documents' ? 'is-active' : ''}`}
        >
          <div className="category-card-top">
            <Database size={17} className="category-icon" />
            <span className="category-count">{documents.length}</span>
          </div>
          <span className="category-title">Document RAG</span>
          <span className="category-desc">Audited filings &amp; reports</span>
        </button>
      </div>

      {/* ── TAB 1: IN-CONTEXT MEMORY ────────────────────────────────── */}
      {activeTab === 'in_context' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            className="card"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={18} color="#38bdf8" />
              <span>Active Working Context</span>
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'rgba(148, 163, 184, 0.85)', margin: '0 0 1rem 0' }}>
              In-context memory tracks entities, company focus, and pending tasks for the ongoing conversation without reloading previous chat turns.
            </p>

            {workingMemories.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(148, 163, 184, 0.6)', fontSize: '0.8rem' }}>
                No active working session memory yet. Ask a stock question in chat to build session context.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {workingMemories.map((mem) => (
                  <div
                    key={mem.id}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#38bdf8' }}>
                        {mem.eventType || 'working_session'}
                      </span>
                      <span style={{ fontSize: '0.62rem', color: 'rgba(148, 163, 184, 0.6)' }}>
                        {new Date(mem.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'rgba(226, 232, 240, 0.95)', lineHeight: 1.5 }}>
                      {mem.summary}
                    </div>
                    {mem.entities && mem.entities.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                        {mem.entities.map((ent) => (
                          <span
                            key={ent}
                            style={{
                              fontSize: '0.6rem',
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              background: 'rgba(56, 189, 248, 0.1)',
                              color: '#38bdf8',
                              border: '1px solid rgba(56, 189, 248, 0.2)',
                            }}
                          >
                            {ent}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: EPISODIC MEMORY ─────────────────────────────────── */}
      {activeTab === 'episodic' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Search & Filter Bar */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <input
                type="text"
                placeholder="Search research episodes (e.g. GAIL, debt, comparison)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadEpisodes()}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.85rem 0.55rem 2.2rem',
                  borderRadius: '8px',
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '0.78rem',
                }}
              />
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'rgba(148, 163, 184, 0.6)' }} />
            </div>

            <select
              value={episodeTypeFilter}
              onChange={(e) => setEpisodeTypeFilter(e.target.value)}
              style={{
                padding: '0.55rem 0.85rem',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '0.78rem',
              }}
            >
              <option value="all">All Event Types</option>
              <option value="company_research">Company Research</option>
              <option value="investment_decision">Investment Decisions</option>
              <option value="stock_comparison">Stock Comparisons</option>
              <option value="portfolio_analysis">Portfolio Analyses</option>
              <option value="document_analysis">Document Analyses</option>
            </select>

            <button type="button" className="btn btn-secondary" onClick={loadEpisodes} style={{ fontSize: '0.75rem', padding: '0.55rem 0.85rem' }}>
              Filter
            </button>
          </div>

          {/* Episodes List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {episodes.length === 0 ? (
              <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'rgba(148, 163, 184, 0.6)', fontSize: '0.8rem', borderRadius: '12px' }}>
                No episodic interaction memories found. Research companies in chat to populate episodic history.
              </div>
            ) : (
              episodes.map((ep) => (
                <div
                  key={ep.id}
                  className="card"
                  style={{
                    padding: '1rem 1.15rem',
                    borderRadius: '10px',
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                            textTransform: 'uppercase',
                          }}
                        >
                          {ep.eventType.replace(/_/g, ' ')}
                        </span>
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>{ep.title}</strong>
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(148, 163, 184, 0.7)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Calendar size={11} />
                        <span>{new Date(ep.eventTimestamp).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
                        <span>·</span>
                        <span>Confidence: {Math.round(ep.confidence * 100)}%</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteEpisodeItem(ep.id)}
                      title="Delete episode"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(239, 68, 68, 0.7)',
                        cursor: 'pointer',
                        padding: '0.2rem',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'rgba(203, 213, 225, 0.9)', margin: 0, lineHeight: 1.45 }}>
                    {ep.summary}
                  </p>

                  {ep.entities.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {ep.entities.map((t) => (
                        <span
                          key={t}
                          style={{
                            fontSize: '0.6rem',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '3px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: 'rgba(203, 213, 225, 0.8)',
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: LONG-TERM MEMORY ─────────────────────────────────── */}
      {activeTab === 'long_term' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Create Long-Term Memory Card */}
          <div
            className="card"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.85rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={16} color="#38bdf8" />
              <span>Record Durable Long-Term Knowledge</span>
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '0.65rem', marginBottom: '0.65rem' }}>
              <select
                value={newLtmCategory}
                onChange={(e) => setNewLtmCategory(e.target.value as any)}
                style={{
                  padding: '0.55rem',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '0.78rem',
                }}
              >
                <option value="preference">Preference</option>
                <option value="procedural">Procedural</option>
                <option value="semantic">Semantic Fact</option>
                <option value="project">Project Note</option>
              </select>

              <input
                type="text"
                placeholder="Title (e.g. Preferred Valuation Metric, Investment Horizon)..."
                value={newLtmTitle}
                onChange={(e) => setNewLtmTitle(e.target.value)}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '0.78rem',
                }}
              />
            </div>

            <textarea
              placeholder="Value / Knowledge text (e.g. Always evaluate PE relative to 5-year historical average and sector median)..."
              value={newLtmValue}
              onChange={(e) => setNewLtmValue(e.target.value)}
              rows={2}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '0.78rem',
                marginBottom: '0.75rem',
                resize: 'vertical',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={createLongTermItem}
                style={{ fontSize: '0.75rem', padding: '0.45rem 1rem' }}
              >
                Save Knowledge Record
              </button>
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(['all', 'preference', 'procedural', 'semantic', 'project'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setLtmCategoryFilter(cat)}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '20px',
                  border: ltmCategoryFilter === cat ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: ltmCategoryFilter === cat ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15, 23, 42, 0.5)',
                  color: ltmCategoryFilter === cat ? '#38bdf8' : 'rgba(148, 163, 184, 0.8)',
                  fontSize: '0.72rem',
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* LTM List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {ltmList.length === 0 ? (
              <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'rgba(148, 163, 184, 0.6)', fontSize: '0.8rem', borderRadius: '12px' }}>
                No long-term knowledge records in this category. Add one above or tell Jaro AI "Remember that..." in chat.
              </div>
            ) : (
              ltmList.map((m) => (
                <div
                  key={m.id}
                  className="card"
                  style={{
                    padding: '0.95rem 1.15rem',
                    borderRadius: '10px',
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: '#818cf8',
                          textTransform: 'uppercase',
                        }}
                      >
                        {m.category}
                      </span>
                      <strong style={{ fontSize: '0.85rem', color: '#f8fafc' }}>{m.title}</strong>
                      {m.version > 1 && (
                        <span style={{ fontSize: '0.6rem', color: 'rgba(148, 163, 184, 0.6)' }}>v{m.version}</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteLongTermItem(m.id)}
                      title="Delete record"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(239, 68, 68, 0.7)',
                        cursor: 'pointer',
                        padding: '0.2rem',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'rgba(203, 213, 225, 0.95)', margin: 0, lineHeight: 1.5 }}>
                    {m.value}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: DOCUMENT KNOWLEDGE BASE (RAG) ────────────────────── */}
      {activeTab === 'documents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Upload Card */}
          <div
            className="card"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Upload size={16} color="#38bdf8" />
              <span>Upload Financial Documents (PDF, DOCX, XLSX, CSV, TXT)</span>
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'rgba(148, 163, 184, 0.85)', margin: '0 0 1rem 0' }}>
              Documents are parsed with structure awareness (tables, headings, page numbers) and indexed for hybrid retrieval in research.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.68rem', color: 'rgba(148, 163, 184, 0.8)', marginBottom: '0.25rem' }}>
                  Document Category
                </label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '0.78rem',
                  }}
                >
                  <option value="annual_report">Annual Report</option>
                  <option value="quarterly_results">Quarterly Results / Statements</option>
                  <option value="investor_presentation">Investor Presentation</option>
                  <option value="research">Research / Equity Report</option>
                  <option value="reference">Reference / Internal Note</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.68rem', color: 'rgba(148, 163, 184, 0.8)', marginBottom: '0.25rem' }}>
                  Reporting Period (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. FY2025, Q2 FY26"
                  value={uploadPeriod}
                  onChange={(e) => setUploadPeriod(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '0.78rem',
                  }}
                />
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.html,.json"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  style={{ fontSize: '0.75rem', padding: '0.55rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Upload size={14} className={isUploading ? 'animate-spin' : ''} />
                  <span>{isUploading ? 'Indexing...' : 'Choose File'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Document Test Search */}
          <div
            className="card"
            style={{
              padding: '1rem 1.25rem',
              borderRadius: '12px',
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <h4 style={{ fontSize: '0.84rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>Test Hybrid Document Retrieval</h4>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Ask a question against your uploaded documents (e.g. FY2025 revenue, operating margin)..."
                value={docSearchQuery}
                onChange={(e) => setDocSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runDocSearch()}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.85rem',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '0.78rem',
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={runDocSearch}
                disabled={isSearchingDocs}
                style={{ fontSize: '0.75rem', padding: '0.5rem 0.9rem' }}
              >
                {isSearchingDocs ? 'Searching...' : 'Search'}
              </button>
            </div>

            {searchedChunks.length > 0 && (
              <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 700 }}>
                  Top {searchedChunks.length} Matched Chunks:
                </span>
                {searchedChunks.map((chunk, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '6px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#38bdf8', marginBottom: '0.25rem' }}>
                      <span>
                        {chunk.documentTitle} {chunk.pageNumber ? `· Page ${chunk.pageNumber}` : ''} {chunk.sectionTitle ? `· ${chunk.sectionTitle}` : ''}
                      </span>
                      <span>Score: {(chunk.score * 100).toFixed(0)}%</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'rgba(226, 232, 240, 0.9)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                      {chunk.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Document Library Table */}
          <div
            className="card"
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.85rem 0' }}>Indexed Documents ({documents.length})</h3>

            {documents.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(148, 163, 184, 0.6)', fontSize: '0.8rem' }}>
                No documents in library. Upload an annual report, financial statements, or research PDF above.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left', color: 'rgba(148, 163, 184, 0.8)' }}>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Document</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Category</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Period</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Pages / Chunks</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Status</th>
                      <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          <strong style={{ display: 'block', color: '#f8fafc' }}>{doc.title}</strong>
                          <span style={{ fontSize: '0.65rem', color: 'rgba(148, 163, 184, 0.6)' }}>{doc.fileName}</span>
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', textTransform: 'capitalize', color: 'rgba(203, 213, 225, 0.9)' }}>
                          {doc.documentCategory.replace(/_/g, ' ')}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', color: 'rgba(203, 213, 225, 0.9)' }}>
                          {doc.reportingPeriod || '—'}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', color: 'rgba(203, 213, 225, 0.8)' }}>
                          {doc.pageCount ? `${doc.pageCount} p.` : '—'} / {doc.chunkCount ?? 0} chunks
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          <span
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              background:
                                doc.ingestionStatus === 'indexed'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : doc.ingestionStatus === 'processing'
                                  ? 'rgba(56, 189, 248, 0.15)'
                                  : 'rgba(239, 68, 68, 0.15)',
                              color:
                                doc.ingestionStatus === 'indexed'
                                  ? '#10b981'
                                  : doc.ingestionStatus === 'processing'
                                  ? '#38bdf8'
                                  : '#ef4444',
                              textTransform: 'uppercase',
                            }}
                          >
                            {doc.ingestionStatus}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => deleteDocItem(doc.id)}
                            title="Delete document"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'rgba(239, 68, 68, 0.7)',
                              cursor: 'pointer',
                              padding: '0.2rem',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
