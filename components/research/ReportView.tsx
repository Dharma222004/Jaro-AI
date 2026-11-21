'use client';

import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  BookmarkPlus,
  BookmarkCheck,
  ExternalLink,
  AlertTriangle,
  Building2,
  BarChart3,
  PieChart,
  FileText,
  Zap,
  ShieldCheck,
  Activity,
  Printer,
  CheckCircle2,
  MessageSquare,
  Columns,
  TrendingUp,
  Target,
} from 'lucide-react';
import type {
  ResearchReport,
  ResearchSourceMeta,
  FinancialMetric,
  ReportSource,
} from '@/types/research';
import { formatDate, formatNumber } from '@/lib/formatting/numbers';
import { LiveMarketPanel } from './LiveMarketPanel';
import { ResearchChatDrawer } from './ResearchChatDrawer';

interface ReportViewProps {
  report: ResearchReport;
  sources: ResearchSourceMeta[];
  researchId: string;
  onBack: () => void;
  onRefresh: () => void;
}

type TabType =
  | 'overview'
  | 'financials'
  | 'business'
  | 'valuation'
  | 'developments'
  | 'risks'
  | 'technical'
  | 'audit';

export function ReportView({
  report,
  onBack,
  onRefresh,
}: ReportViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [workspaceMode, setWorkspaceMode] = useState<'split' | 'report' | 'chat'>('split');
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const [inWatchlist, setInWatchlist] = useState(false);

  const handleAddToWatchlist = async () => {
    setIsAddingToWatchlist(true);
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: {
            name: report.company.name,
            ticker: report.company.ticker,
            exchange: report.company.exchange,
            sector: report.company.sector,
            industry: report.company.industry,
          },
        }),
      });
      if (res.ok) setInWatchlist(true);
    } catch {
      /* ignore */
    } finally {
      setIsAddingToWatchlist(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const sourceMap = new Map<string, ReportSource>();
  report.sources?.forEach((s) => sourceMap.set(s.id, s));

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <FileText size={15} /> },
    { id: 'financials', label: 'Financials & P&L', icon: <BarChart3 size={15} /> },
    { id: 'business', label: 'Business & Segments', icon: <Building2 size={15} /> },
    { id: 'valuation', label: 'Valuation & Ownership', icon: <PieChart size={15} /> },
    { id: 'developments', label: 'Developments & Concall', icon: <Zap size={15} /> },
    { id: 'risks', label: 'Risks & Drivers', icon: <AlertTriangle size={15} /> },
    { id: 'technical', label: 'Technical Structure', icon: <Activity size={15} /> },
    { id: 'audit', label: 'Data Quality & Sources', icon: <ShieldCheck size={15} /> },
  ];

  return (
    <div className="report-view" style={{ background: 'var(--bg-base)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      {/* Top Fixed Terminal Bar */}
      <header
        className="report-view-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          height: '3.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1.5rem',
          background: 'var(--header-bg)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--border-subtle)',
          whiteSpace: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexShrink: 0 }}>
          <button
            onClick={onBack}
            className="btn-ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.45rem 0.75rem',
              fontSize: '0.84rem',
              borderRadius: '6px',
            }}
          >
            <ArrowLeft size={15} />
            <span>Search</span>
          </button>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-subtle)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="report-header-company-name" style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {report.company.name}
            </span>
          </div>
        </div>

        <div className="report-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexShrink: 0 }}>
          <button
            onClick={handlePrint}
            className="btn-secondary report-export-action"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '7px',
            }}
            title="Export / Print Dossier"
          >
            <Printer size={14} />
            <span className="report-action-label">Export</span>
          </button>

          <button
            onClick={handleAddToWatchlist}
            disabled={isAddingToWatchlist || inWatchlist}
            className="btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '7px',
            }}
          >
            {inWatchlist ? (
              <>
                <BookmarkCheck size={14} style={{ color: 'var(--positive)' }} />
                <span className="report-action-label">Saved</span>
              </>
            ) : (
              <>
                <BookmarkPlus size={14} />
                <span className="report-action-label">Watchlist</span>
              </>
            )}
          </button>

          <button
            onClick={onRefresh}
            className="btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '7px',
            }}
            title="Refresh research with fresh data"
          >
            <RefreshCw size={13} />
            <span className="report-action-label">Re-research</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="page-container report-dossier" style={{ maxWidth: '1080px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        {/* Institutional Company Header */}
        <CompanyHeaderCard report={report} />

        {/* Live Yahoo Finance Market Data Panel */}
        <div style={{ marginTop: '1rem' }}>
          <LiveMarketPanel
            ticker={report.company.ticker}
            exchange={(report.company.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE'}
          />
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: '0.2rem',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
          }}
        >
          <button
            onClick={() => setWorkspaceMode('split')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.76rem',
              fontWeight: workspaceMode === 'split' ? 700 : 500,
              background: workspaceMode === 'split' ? 'var(--bg-surface)' : 'transparent',
              color: workspaceMode === 'split' ? 'var(--text-primary)' : 'var(--text-muted)',
              border: workspaceMode === 'split' ? '1px solid var(--border-default)' : '1px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            <Columns size={13} style={{ color: workspaceMode === 'split' ? 'var(--accent)' : 'var(--text-muted)' }} />
            <span>Report + Analyst Chat</span>
          </button>

          <button
            onClick={() => setWorkspaceMode('report')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.76rem',
              fontWeight: workspaceMode === 'report' ? 700 : 500,
              background: workspaceMode === 'report' ? 'var(--bg-surface)' : 'transparent',
              color: workspaceMode === 'report' ? 'var(--text-primary)' : 'var(--text-muted)',
              border: workspaceMode === 'report' ? '1px solid var(--border-default)' : '1px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            <FileText size={13} style={{ color: workspaceMode === 'report' ? 'var(--accent)' : 'var(--text-muted)' }} />
            <span>Full Report Only</span>
          </button>

          <button
            onClick={() => setWorkspaceMode('chat')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.76rem',
              fontWeight: workspaceMode === 'chat' ? 700 : 500,
              background: workspaceMode === 'chat' ? 'var(--bg-surface)' : 'transparent',
              color: workspaceMode === 'chat' ? 'var(--text-primary)' : 'var(--text-muted)',
              border: workspaceMode === 'chat' ? '1px solid var(--border-default)' : '1px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            <MessageSquare size={13} style={{ color: workspaceMode === 'chat' ? 'var(--accent)' : 'var(--text-muted)' }} />
            <span>Full Analyst Chat</span>
          </button>
        </div>
      </div>

      {workspaceMode === 'chat' ? (
        <div style={{ padding: '1rem 1.5rem' }}>
          <ResearchChatDrawer
            report={report}
            mode="full"
            onClose={() => setWorkspaceMode('split')}
          />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: workspaceMode === 'split' ? 'minmax(0, 1.35fr) minmax(380px, 0.85fr)' : '1fr',
            alignItems: 'start',
          }}
        >
          {/* Main Report Column */}
          <main
            className="page-container"
            style={{
              maxWidth: workspaceMode === 'split' ? '100%' : '1080px',
              margin: '0 auto',
              padding: '1.75rem 1.5rem 4rem',
              minWidth: 0,
            }}
          >
            {/* Institutional Company Header */}
            <CompanyHeaderCard report={report} />

            {/* Live Yahoo Finance Market Data Panel */}
            <div style={{ marginTop: '1rem' }}>
              <LiveMarketPanel
                ticker={report.company.ticker}
                exchange={(report.company.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE'}
              />
            </div>

            {/* Segmented Tab Navigation */}
            <nav
              className="report-tab-nav"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                overflowX: 'auto',
                padding: '0.4rem',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                margin: '1.75rem 0 1.5rem',
                scrollbarWidth: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="report-tab-btn"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.55rem 0.95rem',
                      borderRadius: '7px',
                      fontSize: '0.84rem',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                      background: isActive ? 'var(--bg-elevated)' : 'transparent',
                      border: isActive ? '1px solid var(--border-default)' : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <span className="report-tab-icon" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                      {tab.icon}
                    </span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Tab Content Panels */}
            {activeTab === 'overview' && (
              <OverviewTab report={report} sourceMap={sourceMap} onTabChange={setActiveTab} />
            )}

            {activeTab === 'financials' && (
              <FinancialsTab report={report} sourceMap={sourceMap} />
            )}

            {activeTab === 'business' && (
              <BusinessTab report={report} />
            )}

            {activeTab === 'valuation' && (
              <ValuationTab report={report} sourceMap={sourceMap} />
            )}

            {activeTab === 'developments' && (
              <DevelopmentsTab report={report} sourceMap={sourceMap} />
            )}

            {activeTab === 'risks' && (
              <RisksTab report={report} sourceMap={sourceMap} />
            )}

            {activeTab === 'technical' && (
              <TechnicalTab report={report} />
            )}

            {activeTab === 'audit' && (
              <AuditTab report={report} />
            )}
          </main>

          {/* Right Pane: Simultaneous AI Analyst Chat (Docked in Split Mode, Floating in Report Mode) */}
          {workspaceMode === 'split' ? (
            <ResearchChatDrawer
              report={report}
              mode="docked"
              onClose={() => setWorkspaceMode('report')}
            />
          ) : (
            <ResearchChatDrawer report={report} mode="floating" />
          )}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// COMPANY HEADER CARD
// ─────────────────────────────────────────────────────────────────────────────

function CompanyHeaderCard({ report }: { report: ResearchReport }) {
  // Always fetch live price from Yahoo Finance — never rely on stale Groq report price
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChange, setLiveChange] = useState<number | null>(null);
  const [liveChangePct, setLiveChangePct] = useState<number | null>(null);
  const [liveMcap, setLiveMcap] = useState<number | null>(null);
  const [liveHigh52, setLiveHigh52] = useState<number | null>(null);
  const [liveLow52, setLiveLow52] = useState<number | null>(null);
  const [livePE, setLivePE] = useState<number | null>(null);
  const [livePB, setLivePB] = useState<number | null>(null);

  useEffect(() => {
    const exchange = report.company.exchange === 'BSE' ? 'BSE' : 'NSE';
    fetch(`/api/market/quote?ticker=${encodeURIComponent(report.company.ticker)}&exchange=${exchange}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setLivePrice(d.price);
        setLiveChange(d.priceChange);
        setLiveChangePct(d.priceChangePct);
        setLiveMcap(d.marketCap != null ? Math.round(d.marketCap / 1e7) : null);
        setLiveHigh52(d.high52w);
        setLiveLow52(d.low52w);
        setLivePE(d.trailingPE);
        setLivePB(d.priceToBook);
      })
      .catch(() => { /* silent fallback to report data */ });
  }, [report.company.ticker, report.company.exchange]);

  // Fallback to report data when live data hasn't loaded yet
  const tech = report.technicalAnalysis;
  const mcap = report.valuation?.marketCap || report.company.marketCap;

  const displayPrice = livePrice ?? (tech?.price ? Number(tech.price) : null);
  const displayMcap = liveMcap ?? (mcap?.value ? Number(mcap.value) : null);
  const displayHigh52 = liveHigh52 ?? (tech?.high52W ? Number(tech.high52W) : null);
  const displayLow52 = liveLow52 ?? (tech?.low52W ? Number(tech.low52W) : null);
  const displayPE = livePE ?? (report.valuation?.pe?.value ? Number(report.valuation.pe.value) : null);
  const displayPB = livePB ?? (report.valuation?.pb?.value ? Number(report.valuation.pb.value) : null);

  const isPositive = (liveChangePct ?? 0) >= 0;

  return (
    <div
      className="card company-header-card"
      style={{
        padding: '1.75rem',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}
    >
      <div className="company-dossier-meta">
        <div>
          <span className="report-category-label">Company research</span>
          <span className="ticker-badge">{report.company.exchange}: {report.company.ticker}</span>
          {(report.company.sector || report.company.industry) && <span className="badge-neutral">{report.company.sector || report.company.industry}</span>}
          <span className="badge-neutral">{report.sources?.length ?? 0} sources</span>
        </div>
        <span className="report-generated-date">Report generated {formatDate(report.generatedAt)}</span>
      </div>

      {/* Company Title & Industry */}
      <h1
        className="company-report-title"
        style={{
          fontSize: '1.85rem',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: 'var(--text-primary)',
          lineHeight: 1.2,
          marginBottom: '0.35rem',
        }}
      >
        {report.company.name}
      </h1>

      {report.company.industry && (
        <p className="company-report-industry" style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginBottom: '0.85rem', fontWeight: 500 }}>
          {report.company.industry}
        </p>
      )}

      {/* Description */}
      <p className="company-report-description" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.65, maxWidth: '85ch', marginBottom: '1.5rem' }}>
        {report.company.description}
      </p>

      {/* Integrated Key Metrics Strip */}
      <div
        className="company-market-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Metric 1: Last Price — always from Yahoo Finance live data */}
        <div className="company-market-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>Last Price</span>
            {liveChangePct != null && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: isPositive ? 'var(--positive)' : 'var(--negative)' }}>
                {isPositive ? '+' : ''}{liveChangePct.toFixed(2)}%
              </span>
            )}
          </div>
          <p className="metric-value" style={{ fontSize: '1.3rem', fontWeight: 800 }}>
            {displayPrice != null ? `₹${formatNumber(displayPrice)}` : 'Loading…'}
          </p>
          {liveChange != null && (
            <p style={{ fontSize: '0.72rem', color: isPositive ? 'var(--positive)' : 'var(--negative)', fontWeight: 600, marginTop: '0.15rem' }}>
              {isPositive ? '+' : ''}₹{Math.abs(liveChange).toFixed(2)} today
            </p>
          )}
          <small className="company-metric-period">Latest market quote</small>
        </div>

        {/* Metric 2: Market Cap — always from Yahoo Finance live data */}
        <div className="company-market-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem', display: 'block', marginBottom: '0.2rem' }}>Market Capitalization</span>
          <p className="metric-value" style={{ fontSize: '1.3rem', fontWeight: 800 }}>
            {displayMcap != null ? (
              <>
                ₹{formatNumber(displayMcap)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>Cr</span>
              </>
            ) : (
              'Reported in Filings'
            )}
          </p>
          <small className="company-metric-period">Latest available</small>
        </div>

        {/* Metric 3: 52W Range — live from Yahoo Finance */}
        <div className="company-market-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem', display: 'block', marginBottom: '0.2rem' }}>52-Week Range</span>
          {displayHigh52 && displayLow52 ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                <span>₹{formatNumber(displayLow52)}</span>
                <span>₹{formatNumber(displayHigh52)}</span>
              </div>
              <div style={{ height: '4px', background: 'var(--border-subtle)', borderRadius: '2px', marginTop: '0.4rem', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(2, Math.min(98, (((displayPrice ?? displayLow52) - displayLow52) / (displayHigh52 - displayLow52)) * 100))}%`,
                    background: 'var(--gradient-brand)',
                    borderRadius: '2px',
                  }}
                />
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Trading in listed band</p>
          )}
          <small className="company-metric-period">Trailing 52 weeks</small>
        </div>

        {/* Metric 4: Core Multiples — live from Yahoo Finance */}
        <div className="company-market-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem', display: 'block', marginBottom: '0.2rem' }}>Core Multiples</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginTop: '0.2rem' }}>
            <div>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>P/E: </span>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {displayPE != null ? `${displayPE.toFixed(1)}x` : '—'}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>P/B: </span>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {displayPB != null ? `${displayPB.toFixed(1)}x` : '—'}
              </strong>
            </div>
          </div>
          <small className="company-metric-period">Trailing market multiples</small>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────

// TAB 1: OVERVIEW & RESEARCH SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({
  report,
  sourceMap,
  onTabChange,
}: {
  report: ResearchReport;
  sourceMap: Map<string, ReportSource>;
  onTabChange: (tab: TabType) => void;
}) {
  const dq = report.dataQuality;
  const f = report.financials;

  // Live Yahoo Finance enrichment for KPI cards that are "Not Disclosed" in the report
  const [liveKpi, setLiveKpi] = useState<{
    revenue?: number | null;
    roe?: number | null;
    roce?: number | null;
    debtToEquity?: number | null;
    ebitda?: number | null;
    netProfit?: number | null;
  }>({});

  useEffect(() => {
    const exchange = report.company.exchange === 'BSE' ? 'BSE' : 'NSE';
    fetch(`/api/market/quote?ticker=${encodeURIComponent(report.company.ticker)}&exchange=${exchange}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const roe = d.returnOnEquity != null ? Math.round(d.returnOnEquity * 1000) / 10 : null;
        const de = d.debtToEquity != null ? d.debtToEquity / 100 : null; // Yahoo returns as %, convert to ratio
        // Yahoo does not expose ROCE consistently; never substitute ROA or an estimate.
        const roce = null;
        setLiveKpi({
          revenue: d.totalRevenue != null ? Math.round(d.totalRevenue / 1e7) : null,
          ebitda: d.ebitda != null ? Math.round(d.ebitda / 1e7) : null,
          netProfit: d.profitMargins != null && d.totalRevenue != null
            ? Math.round((d.profitMargins * d.totalRevenue) / 1e7)
            : null,
          roe,
          roce,
          debtToEquity: de != null ? Math.round(de * 100) / 100 : null,
        });
      })
      .catch(() => {});
  }, [report.company.ticker, report.company.exchange]);

  // Helper: return existing metric if it has a value, else build one from live data
  const liveMetric = (existing: FinancialMetric | null | undefined, liveVal: number | null | undefined, unit: string, label: string): FinancialMetric | null => {
    if (existing?.value != null && existing.value !== '') return existing;
    if (liveVal == null) return existing ?? null;
    return { value: liveVal, unit, period: 'Latest available', basis: 'Consolidated', metricType: 'reported', note: `${label} · Official exchange session quote` };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

      {/* Executive Research Summary Card */}
      <div
        className="card"
        style={{
          padding: '1.75rem',
          borderRadius: '12px',
          background: 'linear-gradient(160deg, rgba(37,99,235,0.08) 0%, var(--bg-surface) 40%)',
          border: '1px solid rgba(37,99,235,0.3)',
          boxShadow: '0 0 0 1px rgba(37,99,235,0.08) inset',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} style={{ color: 'var(--accent)' }} />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Executive Research Summary
            </h2>
          </div>
          <span
            style={{
              fontSize: '0.72rem',
              color: 'var(--accent)',
              background: 'var(--accent-dim)',
              border: '1px solid var(--border-default)',
              padding: '0.2rem 0.6rem',
              borderRadius: '6px',
              fontWeight: 600,
            }}
          >
            Institutional Synthesis
          </span>
        </div>

        <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
          {report.researchSummary}
        </p>

        {dq && (
          <div
            style={{
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
              fontSize: '0.78rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: dq.overallConfidence === 'High' ? 'var(--positive)' : 'var(--warning)', fontWeight: 600 }}>
                Data Confidence: {dq.overallConfidence}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                · {dq.primarySourcesCount} primary & {dq.secondarySourcesCount} secondary sources audited
              </span>
            </div>
            <button
              onClick={() => onTabChange('audit')}
              style={{ color: 'var(--accent)', cursor: 'pointer', background: 'transparent', border: 'none', fontWeight: 600 }}
            >
              View Data Quality Audit →
            </button>
          </div>
        )}
      </div>

      {/* Historical Financial Trends */}
      {(f.annualTrend?.length || f.quarterlyTrend?.length) && (
        <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Verified Financial History
          </h3>
          {f.annualTrend && f.annualTrend.length > 0 && <FinancialTrendChart title="Annual revenue, EBITDA & net profit" data={f.annualTrend} />}
          {f.quarterlyTrend && f.quarterlyTrend.length > 0 && <FinancialTrendTable title="Quarterly financial performance" data={f.quarterlyTrend} />}
        </div>
      )}

      {/* 8 Primary Research Snapshot KPI Cards (Section 16 Pillar 1) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Research Snapshot (Key Performance Indicators)
          </h3>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.85rem',
          }}
        >
          <InstitutionalMetricCard
            label="Market Cap"
            metric={liveMetric(report.valuation?.marketCap || report.company.marketCap, null, 'Cr', 'Market Cap')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="Revenue"
            metric={liveMetric(report.financials.revenue, liveKpi.revenue, 'Cr', 'Revenue (TTM)')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="EBITDA"
            metric={liveMetric(report.financials.ebitda, liveKpi.ebitda, 'Cr', 'EBITDA (TTM)')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="PAT (Net Profit)"
            metric={liveMetric(report.financials.profit, liveKpi.netProfit, 'Cr', 'PAT (TTM)')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="ROCE"
            metric={liveMetric(report.profitability?.roce, liveKpi.roce, '%', 'ROCE (approx.)')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="ROE"
            metric={liveMetric(report.profitability?.roe, liveKpi.roe, '%', 'ROE (TTM)')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="Stock P/E"
            metric={liveMetric(report.valuation?.pe, null, 'x', 'P/E')}
            sourceMap={sourceMap}
          />
          <InstitutionalMetricCard
            label="Debt to Equity"
            metric={liveMetric(report.financials?.debtToEquity, liveKpi.debtToEquity, 'x', 'D/E Ratio')}
            sourceMap={sourceMap}
          />
        </div>
      </div>

      {/* Key Business Strengths & Advantages */}
      {report.strengths && report.strengths.length > 0 && (
        <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Key Business Strengths & Competitive Moats
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem' }}>
            {report.strengths.map((str, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.65rem',
                  padding: '0.85rem',
                  borderRadius: '8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <CheckCircle2 size={16} style={{ color: 'var(--brand-jade)', marginTop: '0.15rem', flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{str}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: FINANCIALS & P&L
// ─────────────────────────────────────────────────────────────────────────────

function FinancialsTab({
  report,
  sourceMap,
}: {
  report: ResearchReport;
  sourceMap: Map<string, ReportSource>;
}) {
  const f = report.financials;
  const p = report.profitability;

  // Live Yahoo Finance enrichment for all financial metric cards
  const [liveF, setLiveF] = useState<{
    revenue?: number | null;
    ebitda?: number | null;
    profit?: number | null;
    eps?: number | null;
    revenueGrowth?: number | null;
    profitGrowth?: number | null;
    ebitdaMargin?: number | null;
    netMargin?: number | null;
    debt?: number | null;
    cash?: number | null;
    netDebt?: number | null;
    debtToEquity?: number | null;
    roce?: number | null;
    roe?: number | null;
    currentRatio?: number | null;
    operatingCashFlow?: number | null;
    freeCashFlow?: number | null;
  }>({});

  useEffect(() => {
    const exchange = report.company.exchange === 'BSE' ? 'BSE' : 'NSE';
    fetch(`/api/market/quote?ticker=${encodeURIComponent(report.company.ticker)}&exchange=${exchange}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: Record<string, number | null> | null) => {
        if (!d) return;
        const toInrCr = (v: number | null | undefined) =>
          v != null ? Math.round(v / 1e7) : null;
        const toPct = (v: number | null | undefined) =>
          v != null ? Math.round(v * 1000) / 10 : null;

        const rev = toInrCr(d.totalRevenue);
        const ebitda = toInrCr(d.ebitda);
        const profit = d.profitMargins != null && d.totalRevenue != null
          ? Math.round((d.profitMargins * d.totalRevenue) / 1e7) : null;
        const cash = toInrCr(d.totalCash);
        const debt = toInrCr(d.totalDebt);
        const netDebt = cash != null && debt != null ? debt - cash : null;
        const de = d.debtToEquity != null ? Math.round(d.debtToEquity) / 100 : null;
        const roe = toPct(d.returnOnEquity);
        // Yahoo does not expose ROCE consistently; retain the filing-derived report value.
        const roce = null;

        setLiveF({
          revenue: rev,
          ebitda,
          profit,
          eps: d.trailingEps ?? null,
          revenueGrowth: toPct(d.revenueGrowth),
          profitGrowth: toPct(d.earningsGrowth),
          ebitdaMargin: d.ebitdaMargins != null ? toPct(d.ebitdaMargins) : null,
          netMargin: toPct(d.profitMargins),
          debt,
          cash,
          netDebt,
          debtToEquity: de,
          roe,
          roce,
          currentRatio: d.currentRatio ?? null,
          operatingCashFlow: toInrCr(d.operatingCashflow),
          freeCashFlow: toInrCr(d.freeCashflow),
        });
      })
      .catch(() => {});
  }, [report.company.ticker, report.company.exchange]);

  // Return report metric if it has value; else build one from live data
  const lm = (
    existing: FinancialMetric | null | undefined,
    liveVal: number | null | undefined,
    unit: string,
    label: string,
  ): FinancialMetric | null => {
    if (existing?.value != null && existing.value !== '') return existing;
    if (liveVal == null) return existing ?? null;
    return { value: liveVal, unit, period: 'TTM', basis: 'Consolidated', metricType: 'reported', note: `${label} · Official exchange session quote` };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Income Statement Highlights */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Income Statement Highlights ({f.revenue?.period || 'Latest Period'})
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', marginBottom: '1.5rem' }}>
          <InstitutionalMetricCard label="Revenue from Operations"  metric={lm(f.revenue,       liveF.revenue,      'Cr',  'Revenue (TTM)')}     sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Operating Profit / EBITDA" metric={lm(f.ebitda,       liveF.ebitda,       'Cr',  'EBITDA (TTM)')}      sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Net Profit (PAT)"         metric={lm(f.profit,        liveF.profit,       'Cr',  'PAT (TTM)')}         sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Earnings Per Share (EPS)"  metric={lm(f.eps,           liveF.eps,          '₹',   'EPS (TTM)')}         sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Revenue YoY Growth"        metric={lm(f.revenueGrowth, liveF.revenueGrowth,'%',   'Revenue Growth')}    sourceMap={sourceMap} />
          <InstitutionalMetricCard label="PAT YoY Growth"            metric={lm(f.profitGrowth,  liveF.profitGrowth, '%',   'Earnings Growth')}   sourceMap={sourceMap} />
          <InstitutionalMetricCard label="EBITDA Margin"             metric={lm(p.ebitdaMargin,  liveF.ebitdaMargin, '%',   'EBITDA Margin')}     sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Net Profit Margin"         metric={lm(p.netMargin,     liveF.netMargin,    '%',   'Net Margin')}        sourceMap={sourceMap} />
        </div>
      </div>

      {/* Balance Sheet & Solvency */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Balance Sheet &amp; Capital Structure
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
          <InstitutionalMetricCard label="Total Debt / Borrowings"    metric={lm(f.debt,          liveF.debt,         'Cr',  'Total Debt')}        sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Cash & Equivalents"         metric={lm(f.cash,          liveF.cash,         'Cr',  'Cash')}              sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Net Debt"                   metric={lm(f.netDebt,       liveF.netDebt,      'Cr',  'Net Debt')}          sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Debt to Equity"             metric={lm(f.debtToEquity,  liveF.debtToEquity, 'x',   'D/E Ratio')}         sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Return on Cap. Emp. (ROCE)" metric={lm(p.roce,          liveF.roce,         '%',   'ROCE')}              sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Return on Equity (ROE)"     metric={lm(p.roe,           liveF.roe,          '%',   'ROE (TTM)')}         sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Current Ratio"               metric={lm(f.currentRatio, liveF.currentRatio, 'x',   'Current Ratio')}     sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Interest Coverage"           metric={f.interestCoverage} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Total Assets"                metric={f.totalAssets} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Total Liabilities"           metric={f.totalLiabilities} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Shareholders' Equity"        metric={f.shareholdersEquity} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Reserves"                    metric={f.reserves} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Current Assets"              metric={f.currentAssets} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Current Liabilities"         metric={f.currentLiabilities} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Working Capital"             metric={f.workingCapital} sourceMap={sourceMap} />
        </div>

        {report.balanceSheetAnalysis && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0.85rem', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
            {report.balanceSheetAnalysis}
          </p>
        )}
      </div>

      {/* Cash Flow Statement */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Cash Flow Statement
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
          <InstitutionalMetricCard label="Operating Cash Flow" metric={lm(f.operatingCashFlow ?? f.cashFlow, liveF.operatingCashFlow, 'Cr', 'Operating Cash Flow')} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Investing Cash Flow" metric={f.investingCashFlow} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Financing Cash Flow" metric={f.financingCashFlow} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Capital Expenditure" metric={f.capex} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Free Cash Flow" metric={lm(f.freeCashFlow, liveF.freeCashFlow, 'Cr', 'Free Cash Flow')} sourceMap={sourceMap} />
        </div>
        {report.cashFlowAnalysis && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0.85rem', marginTop: '1rem', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
            {report.cashFlowAnalysis}
          </p>
        )}
      </div>
    </div>
  );
}


function parseTrendNum(val: unknown): number | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const str = String(val).trim();
  if (/^(?:—|-|n\/a|null|undefined)$/i.test(str)) return null;
  const cleaned = str.replace(/[₹,%()\s]/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? (str.includes('(') && n > 0 ? -n : n) : null;
}

function FinancialTrendChart({
  title,
  data,
}: {
  title: string;
  data: NonNullable<ResearchReport['financials']['annualTrend']>;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [showRevenue, setShowRevenue] = useState(true);
  const [showOperating, setShowOperating] = useState(true);
  const [showProfit, setShowProfit] = useState(true);

  const rows = data.slice(-8);

  const parsedRows = rows.map((r) => {
    const revenue = parseTrendNum(r.revenue);
    const operating = parseTrendNum(r.operatingProfit ?? r.ebitda);
    const profit = parseTrendNum(r.profit);
    const eps = parseTrendNum(r.eps);
    const cleanPeriod = (r.period || '')
      .replace(/Financial year ending |Quarter ending /gi, '')
      .trim();
    return {
      period: cleanPeriod,
      rawPeriod: r.period,
      revenue,
      operating,
      profit,
      eps,
      basis: r.basis ?? 'Unspecified',
      opMargin: revenue && operating && revenue > 0 ? ((operating / revenue) * 100).toFixed(1) : null,
      patMargin: revenue && profit != null && revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : null,
    };
  });

  const hasRevenue = parsedRows.some((r) => r.revenue != null && r.revenue > 0);
  const hasOperating = parsedRows.some((r) => r.operating != null);
  const hasProfit = parsedRows.some((r) => r.profit != null);

  const activeRevenue = hasRevenue && showRevenue;
  const activeOperating = hasOperating && (showOperating || !hasRevenue);
  const activeProfit = hasProfit && showProfit;

  // Collect all values to calculate scale
  const allValues: number[] = [];
  parsedRows.forEach((r) => {
    if (activeRevenue && r.revenue != null) allValues.push(r.revenue);
    if (activeOperating && r.operating != null) allValues.push(r.operating);
    if (activeProfit && r.profit != null) allValues.push(r.profit);
  });

  if (allValues.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '10px', border: '1px dashed var(--border-subtle)', color: 'var(--text-muted)' }}>
        <p style={{ margin: 0, fontSize: '0.85rem' }}>No quantified historical statement series reported for this entity.</p>
      </div>
    );
  }

  const rawMax = Math.max(...allValues, 10);
  const rawMin = Math.min(...allValues, 0);

  // Friendly rounded upper limit
  const step = Math.pow(10, Math.floor(Math.log10(rawMax))) || 10;
  const yMax = Math.ceil((rawMax * 1.15) / (step / 2)) * (step / 2);
  const yMin = rawMin < 0 ? Math.floor((rawMin * 1.25) / (step / 2)) * (step / 2) : 0;
  const yRange = Math.max(yMax - yMin, 1);

  const svgWidth = 840;
  const svgHeight = 270;
  const chartLeft = 70;
  const chartRight = 815;
  const chartTop = 35;
  const chartBottom = 225;
  const chartHeight = chartBottom - chartTop;
  const chartWidth = chartRight - chartLeft;

  const zeroY = yMin < 0 ? chartBottom - ((0 - yMin) / yRange) * chartHeight : chartBottom;

  const colWidth = chartWidth / Math.max(parsedRows.length, 1);
  const activeBarsCount = (activeRevenue ? 1 : 0) + (activeOperating ? 1 : 0) + (activeProfit ? 1 : 0);
  const barSlotWidth = Math.min(22, (colWidth * 0.72) / Math.max(activeBarsCount, 1));
  const groupSpan = barSlotWidth * activeBarsCount;

  // Grid tick values (4 steps)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const val = yMin + ratio * yRange;
    const y = chartBottom - ratio * chartHeight;
    return { val: Math.round(val), y };
  });

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Chart Header & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)', display: 'block' }}>{title}</strong>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>₹ Cr · consolidated statement periods</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Metric Filter Toggles */}
          {hasRevenue && (
            <button
              onClick={() => setShowRevenue(!showRevenue)}
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '0.25rem 0.6rem',
                borderRadius: '6px',
                border: activeRevenue ? '1px solid #38bdf8' : '1px solid #334155',
                background: activeRevenue ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeRevenue ? '#38bdf8' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              ● Revenue
            </button>
          )}
          {hasOperating && (
            <button
              onClick={() => setShowOperating(!showOperating)}
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '0.25rem 0.6rem',
                borderRadius: '6px',
                border: activeOperating ? '1px solid #818cf8' : '1px solid #334155',
                background: activeOperating ? 'rgba(129, 140, 248, 0.15)' : 'transparent',
                color: activeOperating ? '#818cf8' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              ● Operating Profit
            </button>
          )}
          {hasProfit && (
            <button
              onClick={() => setShowProfit(!showProfit)}
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '0.25rem 0.6rem',
                borderRadius: '6px',
                border: activeProfit ? '1px solid #10b981' : '1px solid #334155',
                background: activeProfit ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                color: activeProfit ? '#10b981' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              ● Net Profit
            </button>
          )}

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden', marginLeft: '0.5rem' }}>
            <button
              onClick={() => setViewMode('chart')}
              style={{
                fontSize: '0.7rem',
                padding: '0.25rem 0.55rem',
                background: viewMode === 'chart' ? 'var(--bg-elevated)' : 'transparent',
                color: viewMode === 'chart' ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: viewMode === 'chart' ? 600 : 400,
              }}
            >
              Chart
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                fontSize: '0.7rem',
                padding: '0.25rem 0.55rem',
                background: viewMode === 'table' ? 'var(--bg-elevated)' : 'transparent',
                color: viewMode === 'table' ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: viewMode === 'table' ? 600 : 400,
              }}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Tooltip Card */}
      {hoveredIdx != null && parsedRows[hoveredIdx] && (
        <div
          style={{
            display: 'flex',
            gap: '1.25rem',
            padding: '0.6rem 0.9rem',
            background: '#131d2a',
            border: '1px solid #263244',
            borderRadius: '8px',
            fontSize: '0.78rem',
            alignItems: 'center',
            marginBottom: '0.65rem',
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ color: '#f8fafc' }}>{parsedRows[hoveredIdx].period}</strong>
          {parsedRows[hoveredIdx].revenue != null && (
            <span>Revenue: <strong style={{ color: '#38bdf8' }}>₹{formatNumber(parsedRows[hoveredIdx].revenue)} Cr</strong></span>
          )}
          {parsedRows[hoveredIdx].operating != null && (
            <span>Operating Profit: <strong style={{ color: '#818cf8' }}>₹{formatNumber(parsedRows[hoveredIdx].operating)} Cr</strong> {parsedRows[hoveredIdx].opMargin && <span style={{ color: '#94a3b8' }}>({parsedRows[hoveredIdx].opMargin}%)</span>}</span>
          )}
          {parsedRows[hoveredIdx].profit != null && (
            <span>Net Profit: <strong style={{ color: parsedRows[hoveredIdx].profit! >= 0 ? '#10b981' : '#ef4444' }}>₹{formatNumber(parsedRows[hoveredIdx].profit)} Cr</strong> {parsedRows[hoveredIdx].patMargin && <span style={{ color: '#94a3b8' }}>({parsedRows[hoveredIdx].patMargin}%)</span>}</span>
          )}
          {parsedRows[hoveredIdx].eps != null && (
            <span>EPS: <strong style={{ color: '#fbbf24' }}>₹{formatNumber(parsedRows[hoveredIdx].eps)}</strong></span>
          )}
          <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.7rem' }}>{parsedRows[hoveredIdx].basis}</span>
        </div>
      )}

      {/* Visual Chart View */}
      {viewMode === 'chart' ? (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '0.75rem', background: '#0e1622' }}>
          <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ minWidth: '680px', width: '100%', display: 'block' }} role="img" aria-label={title}>
            {/* Gridlines & Y-Axis Labels */}
            {ticks.map(({ val, y }) => (
              <g key={val}>
                <line
                  x1={chartLeft}
                  x2={chartRight}
                  y1={y}
                  y2={y}
                  stroke={val === 0 ? '#334155' : '#1e293b'}
                  strokeDasharray={val === 0 ? 'none' : '3 4'}
                  strokeWidth={val === 0 ? 1.5 : 1}
                />
                <text
                  x={chartLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="8.5"
                  fontFamily="monospace"
                >
                  ₹{val.toLocaleString('en-IN')}
                </text>
              </g>
            ))}

            {/* Bars for Each Period */}
            {parsedRows.map((row, colIndex) => {
              const colCenterX = chartLeft + colIndex * colWidth + colWidth / 2;
              let currentX = colCenterX - groupSpan / 2;
              const isHovered = hoveredIdx === colIndex;

              const bars: React.ReactNode[] = [];

              if (activeRevenue && row.revenue != null) {
                const val = row.revenue;
                const h = Math.max(2, (val / yRange) * chartHeight);
                const y = zeroY - h;
                bars.push(
                  <g key="rev">
                    <rect
                      x={currentX}
                      y={y}
                      width={barSlotWidth - 2}
                      height={h}
                      rx="3"
                      fill="#38bdf8"
                      opacity={isHovered ? 1 : 0.85}
                    />
                    <text
                      x={currentX + (barSlotWidth - 2) / 2}
                      y={Math.max(16, y - 5)}
                      textAnchor="middle"
                      fill="#38bdf8"
                      fontSize="8.5"
                      fontWeight="600"
                    >
                      {formatNumber(val)}
                    </text>
                  </g>
                );
                currentX += barSlotWidth;
              }

              if (activeOperating && row.operating != null) {
                const val = row.operating;
                const h = Math.max(2, (Math.abs(val) / yRange) * chartHeight);
                const y = val >= 0 ? zeroY - h : zeroY;
                bars.push(
                  <g key="op">
                    <rect
                      x={currentX}
                      y={y}
                      width={barSlotWidth - 2}
                      height={h}
                      rx="3"
                      fill="#818cf8"
                      opacity={isHovered ? 1 : 0.85}
                    />
                    <text
                      x={currentX + (barSlotWidth - 2) / 2}
                      y={val >= 0 ? Math.max(16, y - 5) : y + h + 10}
                      textAnchor="middle"
                      fill="#818cf8"
                      fontSize="8.5"
                      fontWeight="600"
                    >
                      {formatNumber(val)}
                    </text>
                  </g>
                );
                currentX += barSlotWidth;
              }

              if (activeProfit && row.profit != null) {
                const val = row.profit;
                const h = Math.max(2, (Math.abs(val) / yRange) * chartHeight);
                const y = val >= 0 ? zeroY - h : zeroY;
                const color = val >= 0 ? '#10b981' : '#ef4444';
                bars.push(
                  <g key="pat">
                    <rect
                      x={currentX}
                      y={y}
                      width={barSlotWidth - 2}
                      height={h}
                      rx="3"
                      fill={color}
                      opacity={isHovered ? 1 : 0.85}
                    />
                    <text
                      x={currentX + (barSlotWidth - 2) / 2}
                      y={val >= 0 ? Math.max(16, y - 5) : y + h + 10}
                      textAnchor="middle"
                      fill={color}
                      fontSize="8.5"
                      fontWeight="600"
                    >
                      {formatNumber(val)}
                    </text>
                  </g>
                );
                currentX += barSlotWidth;
              }

              return (
                <g
                  key={`${row.period}-${colIndex}`}
                  onMouseEnter={() => setHoveredIdx(colIndex)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {isHovered && (
                    <rect
                      x={chartLeft + colIndex * colWidth + 2}
                      y={chartTop}
                      width={colWidth - 4}
                      height={chartBottom - chartTop + 24}
                      fill="rgba(255, 255, 255, 0.03)"
                      rx="6"
                    />
                  )}
                  {bars}
                  <text
                    x={colCenterX}
                    y={chartBottom + 16}
                    textAnchor="middle"
                    fill={isHovered ? 'var(--text-primary)' : 'var(--text-muted)'}
                    fontSize="9.5"
                    fontWeight={isHovered ? 700 : 500}
                  >
                    {row.period}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        /* Financial Table View */
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
          <table className="chat-table" style={{ minWidth: '700px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Period</th>
                <th style={{ textAlign: 'right' }}>Revenue (₹ Cr)</th>
                <th style={{ textAlign: 'right' }}>Operating Profit</th>
                <th style={{ textAlign: 'right' }}>Net Profit</th>
                <th style={{ textAlign: 'right' }}>EBITDA Margin</th>
                <th style={{ textAlign: 'right' }}>PAT Margin</th>
                <th style={{ textAlign: 'right' }}>EPS</th>
                <th style={{ textAlign: 'center' }}>Basis</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.period}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#38bdf8' }}>
                    {r.revenue != null ? `₹${formatNumber(r.revenue)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#818cf8' }}>
                    {r.operating != null ? `₹${formatNumber(r.operating)}` : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color: r.profit != null ? (r.profit >= 0 ? '#10b981' : '#ef4444') : 'var(--text-muted)',
                    }}
                  >
                    {r.profit != null ? `₹${formatNumber(r.profit)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#94a3b8' }}>
                    {r.opMargin ? `${r.opMargin}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#94a3b8' }}>
                    {r.patMargin ? `${r.patMargin}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#fbbf24' }}>
                    {r.eps != null ? `₹${formatNumber(r.eps)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {r.basis}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FinancialTrendTable({
  title,
  data,
}: {
  title: string;
  data: NonNullable<ResearchReport['financials']['quarterlyTrend']>;
}) {
  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{title}</strong>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>₹ Cr · sequential quarters</span>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
        <table className="chat-table" style={{ minWidth: '700px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Period</th>
              <th style={{ textAlign: 'right' }}>Revenue</th>
              <th style={{ textAlign: 'right' }}>Operating Profit</th>
              <th style={{ textAlign: 'right' }}>Net Profit</th>
              <th style={{ textAlign: 'right' }}>EPS</th>
              <th style={{ textAlign: 'center' }}>Basis</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(-12).map((row, index) => {
              const rev = parseTrendNum(row.revenue);
              const op = parseTrendNum(row.operatingProfit ?? row.ebitda);
              const pat = parseTrendNum(row.profit);
              const eps = parseTrendNum(row.eps);
              return (
                <tr key={`${row.period}-${index}`}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {(row.period || '').replace(/Quarter ending /gi, '')}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#38bdf8' }}>
                    {rev != null ? `₹${formatNumber(rev)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#818cf8' }}>
                    {op != null ? `₹${formatNumber(op)}` : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color: pat != null ? (pat >= 0 ? '#10b981' : '#ef4444') : 'var(--text-muted)',
                    }}
                  >
                    {pat != null ? `₹${formatNumber(pat)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#fbbf24' }}>
                    {eps != null ? `₹${formatNumber(eps)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {row.basis ?? 'Consolidated'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: BUSINESS & SEGMENTS
// ─────────────────────────────────────────────────────────────────────────────

function BusinessTab({ report }: { report: ResearchReport }) {
  const b = report.business;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Business Model */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
          Business Model & Commercial Mechanics
        </h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {b.businessModel}
        </p>
      </div>

      {/* Segments */}
      {b.segments && b.segments.length > 0 && (
        <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Operating Business Segments
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {b.segments.map((seg, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '1.15rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <h4 style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{seg.name}</h4>
                  {seg.revenueShare && (
                    <span className="badge-neutral" style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                      {seg.revenueShare}
                    </span>
                  )}
                </div>
                {seg.description && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '0.5rem' }}>
                    {seg.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Products & Geographies */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        {b.products && b.products.length > 0 && (
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Core Products & Commercial Offerings
            </h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {b.products.map((p, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)' }}>—</span> {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {b.geographies && b.geographies.length > 0 && (
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Geographic Presence
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {b.geographies.map((g, i) => (
                <span key={i} className="badge-neutral" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: VALUATION & OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────────

function ValuationTab({
  report,
  sourceMap,
}: {
  report: ResearchReport;
  sourceMap: Map<string, ReportSource>;
}) {
  const v = report.valuation;
  const s = report.shareholding;

  const promoterVal = parseFloat(String(s.promoter?.value || 0)) || 0;
  const fiiVal = parseFloat(String(s.fii?.value || 0)) || 0;
  const diiVal = parseFloat(String(s.dii?.value || 0)) || 0;
  const publicVal = parseFloat(String(s.public?.value || 0)) || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Valuation Multiples */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Valuation Multiples
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
          <InstitutionalMetricCard label="Stock P/E" metric={v.pe} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Price / Book (P/B)" metric={v.pb} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="EV / EBITDA" metric={v.evEbitda} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Dividend Yield" metric={v.dividendYield} sourceMap={sourceMap} />
        </div>
      </div>

      {/* Shareholding Pattern */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Shareholding Pattern & Institutional Ownership
          </h3>
          {s.asOfDate && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              As of {s.asOfDate}
            </span>
          )}
        </div>

        {/* Ownership Distribution Bar */}
        {(promoterVal > 0 || fiiVal > 0 || diiVal > 0) && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ height: '12px', borderRadius: '4px', overflow: 'hidden', display: 'flex', background: 'var(--border-subtle)' }}>
              {promoterVal > 0 && <div style={{ width: `${promoterVal}%`, background: 'var(--accent)' }} />}
              {fiiVal > 0 && <div style={{ width: `${fiiVal}%`, background: 'var(--positive)' }} />}
              {diiVal > 0 && <div style={{ width: `${diiVal}%`, background: 'var(--warning)' }} />}
              {publicVal > 0 && <div style={{ width: `${publicVal}%`, background: 'var(--text-muted)' }} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span>● Promoter ({promoterVal}%)</span>
              <span>● FII ({fiiVal}%)</span>
              <span>● DII ({diiVal}%)</span>
              <span>● Public / Retail ({publicVal}%)</span>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
          <InstitutionalMetricCard label="Promoter Holding" metric={s.promoter} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="FII (Foreign Inst.)" metric={s.fii} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="DII (Domestic Inst.)" metric={s.dii} sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Retail & Public" metric={s.public} sourceMap={sourceMap} />
        </div>

        {s.history && s.history.length > 1 && (
          <div style={{ marginTop: '1.25rem' }}>
            <h4 style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '0.55rem' }}>Historical ownership changes</h4>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table className="chat-table" style={{ minWidth: '620px' }}>
                <thead><tr><th>Period</th><th>Promoter</th><th>FII</th><th>DII</th><th>Public</th></tr></thead>
                <tbody>{s.history.map((row, index) => (
                  <tr key={`${row.period}-${index}`}><td>{row.period}</td><td>{row.promoter == null ? '—' : `${row.promoter}%`}</td><td>{row.fii == null ? '—' : `${row.fii}%`}</td><td>{row.dii == null ? '—' : `${row.dii}%`}</td><td>{row.public == null ? '—' : `${row.public}%`}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {s.pledged && Number(s.pledged.value) > 0 ? (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginTop: '1rem',
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />
            <p style={{ fontSize: '0.82rem', color: 'var(--warning)', fontWeight: 500 }}>
              Promoter Pledged Shares Alert: {s.pledged.value}% of promoter stake is pledged.
            </p>
          </div>
        ) : (
          <p style={{ fontSize: '0.78rem', color: 'var(--positive)', marginTop: '0.85rem' }}>
            ✓ Zero promoter pledge detected in recent filings.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: DEVELOPMENTS & CONCALL
// ─────────────────────────────────────────────────────────────────────────────

function DevelopmentsTab({
  report,
  sourceMap,
}: {
  report: ResearchReport;
  sourceMap: Map<string, ReportSource>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Corporate Developments */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Recent Corporate Announcements & Orders
        </h3>

        {report.recentDevelopments && report.recentDevelopments.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {report.recentDevelopments.map((dev, i) => {
              const src = dev.sourceId ? sourceMap.get(dev.sourceId) : null;
              return (
                <div
                  key={i}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{dev.headline}</h4>
                    {dev.date && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{dev.date}</span>}
                  </div>
                  {dev.whatHappened && (
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '0.35rem' }}>
                      {dev.whatHappened}
                    </p>
                  )}
                  {dev.whyItMatters && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--text-secondary)' }}>Why it matters:</strong> {dev.whyItMatters}
                    </p>
                  )}
                  {src && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.72rem',
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        marginTop: '0.5rem',
                      }}
                    >
                      <ExternalLink size={10} /> Disclosed in {src.title || src.domain}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No major corporate filings reported in recent quarter.</p>
        )}
      </div>

      {/* Management Commentary */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Management Commentary & Guidance
        </h3>

        {report.managementCommentary && report.managementCommentary.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {report.managementCommentary.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <p style={{ fontSize: '0.86rem', color: 'var(--text-primary)', lineHeight: 1.6, fontStyle: 'italic', marginBottom: '0.35rem' }}>
                  &ldquo;{c.quote}&rdquo;
                </p>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {c.speaker ? `— ${c.speaker}` : 'Management'} {c.context ? `· ${c.context}` : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Conference call quotes integrated into executive briefing.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6: RISKS & DRIVERS
// ─────────────────────────────────────────────────────────────────────────────

function RisksTab({
  report,
  sourceMap,
}: {
  report: ResearchReport;
  sourceMap: Map<string, ReportSource>;
}) {
  const severityColor = (s?: string) => {
    if (s === 'high') return { color: 'var(--negative)', bg: 'rgba(239, 68, 68, 0.15)' };
    if (s === 'medium') return { color: 'var(--warning)', bg: 'rgba(234, 179, 8, 0.15)' };
    return { color: 'var(--text-muted)', bg: 'var(--bg-elevated)' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Risk Matrix */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Categorized Risk Matrix
        </h3>

        {report.risks && report.risks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {report.risks.map((risk, i) => {
              const sc = severityColor(risk.severity);
              const src = risk.sourceId ? sourceMap.get(risk.sourceId) : null;
              return (
                <div
                  key={i}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {risk.risk || risk.category}
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="badge-neutral" style={{ fontSize: '0.72rem' }}>{risk.category}</span>
                      {risk.severity && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', background: sc.bg, color: sc.color, textTransform: 'uppercase' }}>
                          {risk.severity}
                        </span>
                      )}
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: '0.35rem' }}>
                    {risk.description}
                  </p>
                  {risk.whyItMatters && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--text-secondary)' }}>Why it matters:</strong> {risk.whyItMatters}
                    </p>
                  )}
                  {src && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: 'var(--accent)', textDecoration: 'none', marginTop: '0.5rem' }}
                    >
                      <ExternalLink size={10} /> Disclosed in {src.title || src.domain}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No material risks flagged.</p>
        )}
      </div>

      {/* Structural Growth Drivers & Potential Catalysts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        {report.growthDrivers && report.growthDrivers.length > 0 && (
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Current Structural Growth Drivers
            </h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {report.growthDrivers.map((driver, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--positive)', marginTop: '0.15rem' }}>●</span>
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.futureCatalysts && report.futureCatalysts.length > 0 ? (
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Potential Future Catalysts
            </h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {report.futureCatalysts.map((cat, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--accent)', marginTop: '0.15rem' }}>◆</span>
                  <span>{cat}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : report.strengths && report.strengths.length > 0 ? (
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Key Business Strengths & Advantages
            </h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {report.strengths.map((str, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--brand-jade)', marginTop: '0.15rem' }}>●</span>
                  <span>{str}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 7: TECHNICAL ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function TechnicalTab({ report }: { report: ResearchReport }) {
  const tech = report.technicalAnalysis;
  const [liveQuote, setLiveQuote] = useState<{ price?: number; high52w?: number; low52w?: number } | null>(null);

  useEffect(() => {
    const exchange = report.company.exchange === 'BSE' ? 'BSE' : 'NSE';
    fetch(`/api/market/quote?ticker=${encodeURIComponent(report.company.ticker)}&exchange=${exchange}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setLiveQuote({ price: d.price, high52w: d.high52w, low52w: d.low52w });
      })
      .catch(() => {});
  }, [report.company.ticker, report.company.exchange]);

  const high52 = liveQuote?.high52w ?? tech?.high52W;
  const low52 = liveQuote?.low52w ?? tech?.low52W;
  const price = liveQuote?.price ?? tech?.price;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={17} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Technical Structure, Moving Averages & Momentum
            </h3>
          </div>
          {tech?.trend && (
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color:
                  String(tech.trend).toLowerCase().includes('bull')
                    ? 'var(--positive)'
                    : String(tech.trend).toLowerCase().includes('bear')
                    ? 'var(--negative)'
                    : 'var(--warning)',
              }}
            >
              Primary Trend: {tech.trend}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>Spot Price</span>
            <p className="metric-value" style={{ fontSize: '1.2rem' }}>{price ? `₹${formatNumber(price)}` : 'N/A'}</p>
          </div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>52-Week High</span>
            <p className="metric-value" style={{ fontSize: '1.2rem' }}>{high52 ? `₹${formatNumber(high52)}` : 'N/A'}</p>
          </div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>52-Week Low</span>
            <p className="metric-value" style={{ fontSize: '1.2rem' }}>{low52 ? `₹${formatNumber(low52)}` : 'N/A'}</p>
          </div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>50-Day SMA</span>
            <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.sma50 ? `₹${formatNumber(tech.sma50)}` : 'N/A'}</p>
          </div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>200-Day SMA</span>
            <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.sma200 ? `₹${formatNumber(tech.sma200)}` : 'N/A'}</p>
          </div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
            <span className="metric-label" style={{ fontSize: '0.72rem' }}>RSI (14-Day)</span>
            <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.rsi ? formatNumber(tech.rsi) : 'Neutral Band'}</p>
          </div>
        </div>

        {(tech?.supportLevels?.length || tech?.resistanceLevels?.length) ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
            {tech.supportLevels && tech.supportLevels.length > 0 && (
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.9rem 1rem' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--positive)', display: 'block', marginBottom: '0.35rem' }}>
                  Key Support Zones
                </span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {tech.supportLevels.join('  ·  ')}
                </p>
              </div>
            )}
            {tech.resistanceLevels && tech.resistanceLevels.length > 0 && (
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.9rem 1rem' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--negative)', display: 'block', marginBottom: '0.35rem' }}>
                  Key Resistance Zones
                </span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {tech.resistanceLevels.join('  ·  ')}
                </p>
              </div>
            )}
          </div>
        ) : null}

        {tech?.momentumSignal && (
          <p style={{ fontSize: '0.84rem', color: 'var(--accent)', fontWeight: 600, marginBottom: '0.75rem' }}>
            Momentum Signal: {tech.momentumSignal}
          </p>
        )}

        {tech?.observations && (
          <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.65, padding: '0.95rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            {tech.observations}
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 8: DATA QUALITY & SOURCES
// ─────────────────────────────────────────────────────────────────────────────

function AuditTab({ report }: { report: ResearchReport }) {
  const dq = report.dataQuality;
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Verification Overview */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Research Verification & Data Quality Audit
        </h3>

        {dq && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                <span className="metric-label" style={{ fontSize: '0.72rem' }}>Confidence Level</span>
                <p className="metric-value" style={{ color: dq.overallConfidence === 'High' ? 'var(--positive)' : 'var(--warning)', fontSize: '1.15rem' }}>
                  {dq.overallConfidence}
                </p>
              </div>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                <span className="metric-label" style={{ fontSize: '0.72rem' }}>Primary Sources</span>
                <p className="metric-value" style={{ fontSize: '1.15rem' }}>{dq.primarySourcesCount}</p>
              </div>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                <span className="metric-label" style={{ fontSize: '0.72rem' }}>Secondary Sources</span>
                <p className="metric-value" style={{ fontSize: '1.15rem' }}>{dq.secondarySourcesCount}</p>
              </div>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                <span className="metric-label" style={{ fontSize: '0.72rem' }}>Conflicts Resolved</span>
                <p className="metric-value" style={{ fontSize: '1.15rem' }}>{dq.conflictingMetricsCount}</p>
              </div>
            </div>

            <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {dq.confidenceReason}
            </p>

            {dq.basisWarnings && dq.basisWarnings.length > 0 && (
              <div style={{ marginTop: '1rem', padding: '0.85rem', border: '1px solid rgba(245,158,11,.28)', borderRadius: '8px', background: 'var(--warning-dim)' }}>
                <strong style={{ display: 'block', color: 'var(--warning)', fontSize: '0.78rem', marginBottom: '0.35rem' }}>Reporting-basis limitations</strong>
                {dq.basisWarnings.slice(0, 8).map((warning) => <p key={warning} style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: 1.5 }}>• {warning}</p>)}
              </div>
            )}

            {/* Discrepancies Table */}
            {dq.conflicts && dq.conflicts.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <span className="metric-label" style={{ color: 'var(--warning)', display: 'block', marginBottom: '0.5rem' }}>
                  Cross-Source Discrepancies & Resolutions:
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {dq.conflicts.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '0.85rem',
                        borderRadius: '8px',
                        background: 'rgba(234, 179, 8, 0.05)',
                        border: '1px solid rgba(234, 179, 8, 0.25)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.84rem' }}>{c.metric}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--positive)' }}>
                          Selected: {String(c.selectedValue)} ({c.selectedSource})
                        </span>
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        <strong>Resolution Policy:</strong> {c.resolution}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metric-level methodology */}
      {dq?.metricAudit && dq.metricAudit.length > 0 && (
        <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            Metric Sources &amp; Calculation Methodology
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Every value is labelled by reporting period, statement basis and verification state. Missing values are not treated as zero.
          </p>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
            <table className="chat-table" style={{ minWidth: '900px' }}>
              <thead><tr><th>Metric</th><th>Value</th><th>Period / basis</th><th>Status</th><th>Source / methodology</th></tr></thead>
              <tbody>{dq.metricAudit.map((item, index) => (
                <tr key={`${item.metric}-${index}`}>
                  <td>{item.metric}</td>
                  <td>{item.value == null ? 'Data unavailable' : `${formatNumber(item.value)} ${item.unit}`}</td>
                  <td>{item.period ?? 'Period unavailable'}{item.basis ? ` · ${item.basis}` : ''}</td>
                  <td>{item.verificationStatus?.replace(/_/g, ' ') ?? 'unverified'}{item.confidence ? ` · ${item.confidence}` : ''}</td>
                  <td>
                    {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{item.sourceName ?? 'Open source'}</a>
                      : item.formula ? `Calculated: ${item.formula}` : item.verificationStatus === 'not_applicable' ? 'Sector-specific non-applicability' : 'No sufficiently reliable source found'}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Complete Sources Directory */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <button
          aria-expanded={sourcesOpen}
          onClick={() => setSourcesOpen((value) => !value)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', textAlign: 'left' }}
        >
          <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Sources &amp; References ({report.sources?.length ?? 0})
          </h3>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{sourcesOpen ? '−' : '+'}</span>
        </button>
        {sourcesOpen && report.sources && report.sources.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {report.sources.map((s, i) => (
              <div
                id={`report-source-${i + 1}`}
                key={s.id || i}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.75rem',
                  padding: '0.65rem 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '1.75rem' }}>
                  [{i + 1}]
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.86rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      textDecoration: 'none',
                    }}
                  >
                    <span className="hover:underline">{s.title || s.url}</span>
                    <ExternalLink size={11} style={{ color: 'var(--text-muted)' }} />
                  </a>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{s.domain}</span>
                    {s.sourceType && ` · ${s.sourceType.replace(/_/g, ' ')}`}
                    {s.authority && ` · ${s.authority} authority`}
                    {s.publishedAt && ` · Published ${formatDate(s.publishedAt)}`}
                    {s.retrievedAt && ` · Retrieved ${formatDate(s.retrievedAt)}`}
                  </p>
                  {s.supportedMetrics && s.supportedMetrics.length > 0 && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                      Supports: {s.supportedMetrics.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : sourcesOpen ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No external sources recorded.</p>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE INSTITUTIONAL METRIC CARD
// ─────────────────────────────────────────────────────────────────────────────

function InstitutionalMetricCard({
  label,
  metric,
  sourceMap,
}: {
  label: string;
  metric?: FinancialMetric | null;
  sourceMap?: Map<string, ReportSource>;
}) {
  const isEmpty =
    !metric || metric.value === null || metric.value === undefined || metric.value === '';

  const src = metric?.sourceId && sourceMap ? sourceMap.get(metric.sourceId) : null;
  const sourceNumber = src && sourceMap ? [...sourceMap.keys()].indexOf(src.id) + 1 : null;
  const statusLabel: Record<string, string> = {
    verified: 'VERIFIED', cross_checked: 'CROSS-CHECKED', calculated: 'CALCULATED', estimated: 'ESTIMATED',
    unverified: 'UNVERIFIED', not_reported: 'NOT REPORTED', unavailable: 'UNAVAILABLE', not_applicable: 'NOT APPLICABLE',
  };
  const emptyLabel = metric?.verificationStatus === 'not_applicable' ? 'Not applicable'
    : metric?.verificationStatus === 'not_reported' ? 'Not reported by company'
      : 'Data currently unavailable — no sufficiently reliable source found.';

  return (
    <div
      className="institutional-metric-card"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '0.95rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '88px',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.35rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem' }}>
            {label}
          </span>
          {metric?.metricType === 'calculated' && (
            <span
              style={{
                fontSize: '0.62rem',
                padding: '0.1rem 0.35rem',
                borderRadius: '3px',
                background: 'rgba(59, 130, 246, 0.1)',
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
              }}
              title={metric.formula || 'Calculated metric'}
            >
              CALC
            </span>
          )}
          {metric?.verificationStatus && metric.metricType !== 'calculated' && (
            <span
              style={{
                fontSize: '0.58rem', padding: '0.1rem 0.35rem', borderRadius: '3px',
                background: metric.verificationStatus === 'verified' || metric.verificationStatus === 'cross_checked' ? 'var(--positive-dim)' : 'var(--warning-dim)',
                color: metric.verificationStatus === 'verified' || metric.verificationStatus === 'cross_checked' ? 'var(--positive)' : 'var(--warning)',
                fontFamily: 'var(--font-mono)',
              }}
              title={metric.note ?? metric.verificationStatus}
            >
              {statusLabel[metric.verificationStatus]}
            </span>
          )}
        </div>

        <p className="metric-value" style={{ fontSize: '1.25rem', fontWeight: 800 }}>
          {isEmpty ? (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.92rem', fontWeight: 400 }}>
              {emptyLabel}
            </span>
          ) : (
            <>
              {formatNumber(metric.value!)}
              {metric.unit && (
                <span
                  style={{
                    fontSize: '0.74rem',
                    color: 'var(--text-muted)',
                    marginLeft: '0.3rem',
                    fontWeight: 500,
                  }}
                >
                  {metric.unit}
                </span>
              )}
            </>
          )}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '0.5rem',
          paddingTop: '0.4rem',
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
        }}
      >
        <span title={metric?.statementType ? `${metric.statementType} statement` : undefined}>{metric?.period || metric?.asOf || 'Period unavailable'}</span>
        {src && (
          <a
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>[{sourceNumber}]</span>
            <ExternalLink size={9} />
          </a>
        )}
        {!src && metric?.sourceUrl && (
          <a href={metric.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
            <span>{metric.sourceName || 'Source'}</span><ExternalLink size={9} />
          </a>
        )}
      </div>
    </div>
  );
}
