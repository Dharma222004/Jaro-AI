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
} from 'lucide-react';
import type {
  ResearchReport,
  ResearchSourceMeta,
  FinancialMetric,
  ReportSource,
} from '@/types/research';
import { formatDate, formatNumber } from '@/lib/formatting/numbers';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { LiveMarketPanel } from './LiveMarketPanel';

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
  sources,
  researchId,
  onBack,
  onRefresh,
}: ReportViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
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
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      {/* Top Fixed Terminal Bar */}
      <header
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
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {report.company.name}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexShrink: 0 }}>
          <ThemeToggle size="sm" />

          <button
            onClick={handlePrint}
            className="btn-secondary"
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
            <span>Export</span>
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
                <span>Saved</span>
              </>
            ) : (
              <>
                <BookmarkPlus size={14} />
                <span>Watchlist</span>
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
            <span>Re-research</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="page-container" style={{ maxWidth: '1080px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        {/* Institutional Company Header */}
        <CompanyHeaderCard report={report} />

        {/* Live Yahoo Finance Market Data Panel */}
        <div style={{ marginTop: '1rem' }}>
          <LiveMarketPanel
            ticker={report.company.ticker}
            exchange={(report.company.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE'}
          />
        </div>

        {/* Clean Segmented Pill Navigation */}
        <nav
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
            whiteSpace: 'nowrap',
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
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
                  boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
                }}
              >
                <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                {tab.id === 'audit' && report.dataQuality?.conflicts && report.dataQuality.conflicts.length > 0 && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '10px',
                      background: 'rgba(234, 179, 8, 0.15)',
                      color: 'var(--warning)',
                      fontWeight: 600,
                    }}
                  >
                    {report.dataQuality.conflicts.length}
                  </span>
                )}
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
      className="card"
      style={{
        padding: '1.75rem',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          Updated: {formatDate(report.generatedAt)}
        </span>
      </div>

      {/* Company Title & Industry */}
      <h1
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
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginBottom: '0.85rem', fontWeight: 500 }}>
          {report.company.industry}
        </p>
      )}

      {/* Description */}
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.65, maxWidth: '85ch', marginBottom: '1.5rem' }}>
        {report.company.description}
      </p>

      {/* Integrated Key Metrics Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Metric 1: Last Price — always from Yahoo Finance live data */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
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
        </div>

        {/* Metric 2: Market Cap — always from Yahoo Finance live data */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
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
        </div>

        {/* Metric 3: 52W Range — live from Yahoo Finance */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
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
        </div>

        {/* Metric 4: Core Multiples — live from Yahoo Finance */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
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
        // Approximate ROCE ≈ ROE / (1 − D/(D+E)) or use returnOnAssets as proxy
        const roce = d.returnOnAssets != null
          ? Math.round(d.returnOnAssets * 1000) / 10
          : (roe != null && de != null ? Math.round(roe * (1 + de) * 10) / 10 : null);
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
    return { value: liveVal, unit, period: 'Live', basis: 'Consolidated', metricType: 'reported', note: `${label} · Source: Yahoo Finance (live)` };
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
                ● Data Confidence: {dq.overallConfidence}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                ({dq.primarySourcesCount} primary & {dq.secondarySourcesCount} secondary sources audited)
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
        const roce = d.returnOnAssets != null
          ? toPct(d.returnOnAssets)
          : (roe != null && de != null ? Math.round(roe * (1 + de) * 10) / 10 : null);

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
    return { value: liveVal, unit, period: 'TTM', basis: 'Consolidated', metricType: 'reported', note: `${label} · Yahoo Finance live` };
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
          <InstitutionalMetricCard label="Return on Cap. Emp. (ROCE)" metric={lm(p.roce,          liveF.roce,         '%',   'ROCE (approx.)')}    sourceMap={sourceMap} />
          <InstitutionalMetricCard label="Return on Equity (ROE)"     metric={lm(p.roe,           liveF.roe,          '%',   'ROE (TTM)')}         sourceMap={sourceMap} />
        </div>

        {report.balanceSheetAnalysis && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0.85rem', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
            {report.balanceSheetAnalysis}
          </p>
        )}
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
                  borderLeft: '3px solid var(--accent)',
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
                  <span>{typeof driver === 'string' ? driver : (driver as any).driver}</span>
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

  return (
    <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
      <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
        Technical Structure & Price Action
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem' }}>52-Week High</span>
          <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.high52W ? `₹${formatNumber(tech.high52W)}` : 'N/A'}</p>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem' }}>52-Week Low</span>
          <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.low52W ? `₹${formatNumber(tech.low52W)}` : 'N/A'}</p>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem' }}>50-Day SMA</span>
          <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.sma50 ? `₹${formatNumber(tech.sma50)}` : 'N/A'}</p>
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <span className="metric-label" style={{ fontSize: '0.72rem' }}>200-Day SMA</span>
          <p className="metric-value" style={{ fontSize: '1.2rem' }}>{tech?.sma200 ? `₹${formatNumber(tech.sma200)}` : 'N/A'}</p>
        </div>
      </div>

      {tech?.observations && (
        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0.85rem', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
          {tech.observations}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 8: DATA QUALITY & SOURCES
// ─────────────────────────────────────────────────────────────────────────────

function AuditTab({ report }: { report: ResearchReport }) {
  const dq = report.dataQuality;

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

      {/* Complete Sources Directory */}
      <div className="card" style={{ padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Sources & Evidence
        </h3>
        {report.sources && report.sources.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {report.sources.map((s, i) => (
              <div
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
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No external sources recorded.</p>
        )}
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

  return (
    <div
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
        </div>

        <p className="metric-value" style={{ fontSize: '1.25rem', fontWeight: 800 }}>
          {isEmpty ? (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.92rem', fontWeight: 400 }}>
              Not Disclosed
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
        <span>{metric?.period || 'Reported'}</span>
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
            <span>[{src.id}]</span>
            <ExternalLink size={9} />
          </a>
        )}
      </div>
    </div>
  );
}
