import { identifyCompany } from '@/lib/research/company-resolver';
import { collectMultiSourceData } from '@/lib/research/tavily-collector';
import { extractFinancialMetrics } from '@/lib/research/metric-extractor';
import { validateAndDetectConflicts } from '@/lib/research/validator-engine';
import { generateInstitutionalAnalysis } from '@/lib/research/groq-analyzer';
import { safeValidateResearchReport } from '@/lib/validation/report-schema';
import { fetchLiveMarketData } from '@/lib/yahoo-finance/client';
import type { CompanyIdentity, CompanyCandidate } from '@/types/company';
import type { ResearchReport, ResearchSourceMeta } from '@/types/research';

// ─── Lazy DB import — DB is completely optional ───────────────────────────────
// If DATABASE_URL is missing / unreachable the whole research still works.
// All DB calls are wrapped in try/catch and silently skipped on failure.
async function tryDb() {
  try {
    const { upsertCompany, createResearchReport, updateResearchReport, saveResearchSources, getLatestReportForCompany } =
      await import('@/lib/database/operations');
    return { upsertCompany, createResearchReport, updateResearchReport, saveResearchSources, getLatestReportForCompany };
  } catch {
    return null;
  }
}

export interface ResearchOrchestrationResult {
  researchId: string;
  status: 'completed' | 'failed';
  company?: CompanyIdentity;
  report?: ResearchReport;
  sources?: ResearchSourceMeta[];
  error?: string;
  processingMs?: number;
  fromCache?: boolean;
}

export type StageCallback = (stage: string, status: 'running' | 'completed' | 'failed', detail?: string) => void;

/**
 * Main institutional equity research orchestrator.
 * Database is optional — all DB operations are best-effort.
 * If DB is unavailable, research runs fully and returns results without caching.
 */
export async function runResearchPipeline(params: {
  query: string;
  company: CompanyIdentity;
  forceRefresh?: boolean;
  onStage?: StageCallback;
  reportId?: string;
}): Promise<ResearchOrchestrationResult> {
  const { query, company, onStage, forceRefresh = false } = params;
  const startTime = Date.now();

  const notify = (stage: string, status: 'running' | 'completed' | 'failed', detail?: string) => {
    onStage?.(stage, status, detail);
    console.log(`[research] ${stage}: ${status}${detail ? ` (${detail})` : ''}`);
  };

  // Generate a fallback ID in case DB is not available
  const { randomUUID } = await import('crypto');
  let reportId = params.reportId ?? randomUUID();
  let dbAvailable = false;
  let dbCompanyId: string | null = null;

  // ── 1. Try DB upsert (non-fatal) ────────────────────────────────────────────
  try {
    const db = await tryDb();
    if (db) {
      const dbCompany = await db.upsertCompany({
        name: company.name,
        ticker: company.ticker,
        exchange: company.exchange,
        sector: company.sector,
        industry: company.industry,
        country: company.country,
      });
      dbCompanyId = dbCompany.id;
      dbAvailable = true;

      // ── 2. Check 24-hour cache ────────────────────────────────────────────
      if (!forceRefresh && dbCompanyId) {
        const cached = await db.getLatestReportForCompany(dbCompanyId);
        if (cached && cached.reportJson) {
          const ageMs = Date.now() - cached.createdAt.getTime();
          if (ageMs < 24 * 60 * 60 * 1000) {
            try {
              const cachedReport = JSON.parse(cached.reportJson) as ResearchReport;
              const cachedSources: ResearchSourceMeta[] = cached.sources.map((s) => ({
                id: s.id,
                url: s.url,
                title: s.title,
                domain: s.domain,
                sourceType: (s.sourceType as ResearchSourceMeta['sourceType']) ?? 'other',
                authority: (s.authority ?? 'low') as ResearchSourceMeta['authority'],
                relevance: s.relevance ?? undefined,
                publishedAt: s.publishedAt?.toISOString(),
                retrievedAt: s.retrievedAt.toISOString(),
                snippet: s.snippet ?? undefined,
              }));
              return {
                researchId: cached.id,
                status: 'completed',
                company,
                report: cachedReport,
                sources: cachedSources,
                processingMs: 0,
                fromCache: true,
              };
            } catch {
              // Cache parse failed — continue with fresh research
            }
          }
        }
      }

      // ── 3. Create report record ───────────────────────────────────────────
      if (dbCompanyId) {
        const reportRecord = await db.createResearchReport({
          companyId: dbCompanyId,
          query,
          status: 'running',
        });
        reportId = reportRecord.id;
      }
    }
  } catch (dbErr) {
    console.warn('[research] DB unavailable — running without persistence:', dbErr instanceof Error ? dbErr.message : dbErr);
    dbAvailable = false;
  }

  try {
    // ── 4. Web Research Layer ─────────────────────────────────────────────────
    notify('web_research', 'running', 'Searching Screener, BSE/NSE filings, investor presentations, and financial press');
    let webData;
    try {
      webData = await collectMultiSourceData(company, (msg) => notify('web_research', 'running', msg));
      notify('web_research', 'completed', `Retrieved and prioritized ${webData.sources.length} financial sources`);
    } catch (err) {
      notify('web_research', 'failed');
      throw new Error(`Web research failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // ── 5. Metric Extraction ──────────────────────────────────────────────────
    notify('metric_extraction', 'running', 'Parsing Screener ratios, quarterly P&L, balance sheet, and shareholding');
    const extractedMetrics = extractFinancialMetrics({
      company,
      screenerText: webData.screenerContent ?? '',
      filingText: webData.filingContent ?? '',
      technicalText: webData.technicalContent ?? '',
      sources: webData.sources,
    });
    notify('metric_extraction', 'completed', 'Fundamental metrics extracted and derived metrics calculated');

    // ── 6. Cross-Source Validation ────────────────────────────────────────────
    notify('validation', 'running', 'Cross-checking disclosures across BSE/NSE filings vs financial databases');
    const validationOutput = validateAndDetectConflicts({
      extracted: extractedMetrics,
      sources: webData.sources,
      filingText: webData.filingContent ?? '',
      screenerText: webData.screenerContent ?? '',
    });
    notify(
      'validation',
      'completed',
      `Data quality: ${validationOutput.dataQuality.overallConfidence} confidence (${validationOutput.dataQuality.conflictingMetricsCount} conflicts detected)`
    );

    // ── 7. Groq LLM Institutional Analysis ───────────────────────────────────
    notify('ai_analysis', 'running', 'Synthesizing business segments, growth drivers, categorized risks, and commentary');
    let finalReport: ResearchReport;
    try {
      finalReport = await generateInstitutionalAnalysis({
        company,
        query,
        validationOutput,
        segmentText: webData.segmentContent ?? '',
        newsText: webData.newsContent ?? '',
        commentaryText: webData.commentaryContent ?? '',
        riskText: webData.riskContent ?? '',
        sources: webData.sources,
        generatedAt: new Date().toISOString(),
      });
      notify('ai_analysis', 'completed', 'Institutional equity analysis synthesized');
    } catch (err) {
      notify('ai_analysis', 'failed');
      throw new Error(`AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // ── 7b. Yahoo Finance Live Data Enrichment (non-blocking) ────────────────
    try {
      notify('live_data', 'running', 'Fetching live price & fundamentals from Yahoo Finance');
      const yfExchange = company.exchange === 'BSE' ? 'BSE' : 'NSE';
      const liveData = await fetchLiveMarketData(company.ticker, yfExchange);
      if (liveData) {
        const m = (v: number | null, unit = '', period = 'Live'): ResearchReport['valuation']['pe'] => ({
          value: v,
          unit,
          period,
          basis: 'Consolidated' as const,
          metricType: 'reported' as const,
          note: 'Source: Yahoo Finance (live)',
        });

        finalReport.technicalAnalysis = {
          ...finalReport.technicalAnalysis,
          price: liveData.price,
          high52W: liveData.high52w,
          low52W: liveData.low52w,
        };

        const val = finalReport.valuation ?? { pe: { value: null, unit: 'x' }, pb: { value: null, unit: 'x' }, marketCap: { value: null, unit: 'Cr' } };
        if (liveData.trailingPE != null && !val.pe?.value)    val.pe        = m(Math.round(liveData.trailingPE * 10) / 10, 'x');
        if (liveData.priceToBook != null && !val.pb?.value)   val.pb        = m(Math.round(liveData.priceToBook * 10) / 10, 'x');
        if (liveData.marketCap != null) {
          const mcapCr = Math.round(liveData.marketCap / 1e7);
          val.marketCap = m(mcapCr, 'Cr');
          finalReport.company.marketCap = m(mcapCr, 'Cr');
        }
        if (liveData.dividendYield != null)                   val.dividendYield = m(Math.round(liveData.dividendYield * 10000) / 100, '%');
        if (liveData.evEbitda != null && !val.evEbitda?.value) val.evEbitda  = m(Math.round(liveData.evEbitda * 10) / 10, 'x');
        if (liveData.forwardPE != null && !val.forwardPe?.value) val.forwardPe = m(Math.round(liveData.forwardPE * 10) / 10, 'x');
        finalReport.valuation = val;

        const prof = finalReport.profitability ?? { roe: { value: null, unit: '%' }, roce: { value: null, unit: '%' }, netMargin: { value: null, unit: '%' } };
        if (liveData.returnOnEquity != null && !prof.roe?.value)       prof.roe          = m(Math.round(liveData.returnOnEquity * 1000) / 10, '%');
        if (liveData.returnOnAssets != null && !prof.roa?.value)       prof.roa          = m(Math.round(liveData.returnOnAssets * 1000) / 10, '%');
        if (liveData.profitMargins != null && !prof.netMargin?.value)  prof.netMargin    = m(Math.round(liveData.profitMargins * 1000) / 10, '%');
        if (liveData.grossMargins != null && !prof.grossMargin?.value) prof.grossMargin  = m(Math.round(liveData.grossMargins * 1000) / 10, '%');
        if (liveData.operatingMargins != null && !prof.operatingMargin?.value) prof.operatingMargin = m(Math.round(liveData.operatingMargins * 1000) / 10, '%');
        if (liveData.ebitdaMargins != null && !prof.ebitdaMargin?.value)       prof.ebitdaMargin    = m(Math.round(liveData.ebitdaMargins * 1000) / 10, '%');
        finalReport.profitability = prof;

        notify('live_data', 'completed', `Live: ₹${liveData.price} · ${liveData.exchange} · P/E ${liveData.trailingPE?.toFixed(1) ?? '—'}x`);
      } else {
        notify('live_data', 'completed', 'Yahoo Finance: ticker not found — using Tavily data');
      }
    } catch (liveErr) {
      console.warn('[research] Yahoo Finance enrichment failed (non-fatal):', liveErr);
      notify('live_data', 'completed', 'Live data unavailable — using Tavily data');
    }

    // ── 8. Schema Validation ──────────────────────────────────────────────────
    notify('report_validation', 'running');
    const safeValidation = safeValidateResearchReport(finalReport);
    if (!safeValidation.success) {
      console.warn('[research] Validation warnings (sanitized):', safeValidation.errors);
    }
    const validatedReport = safeValidation.data;
    notify('report_validation', 'completed');

    // ── 9. Persist to DB (non-fatal) ──────────────────────────────────────────
    const processingMs = Date.now() - startTime;
    if (dbAvailable) {
      try {
        const db = await tryDb();
        if (db) {
          await db.updateResearchReport(reportId, {
            status: 'completed',
            reportJson: JSON.stringify(validatedReport),
            processingMs,
          });
          await db.saveResearchSources(reportId, webData.sources);
        }
      } catch (saveErr) {
        console.warn('[research] DB save failed (non-fatal):', saveErr instanceof Error ? saveErr.message : saveErr);
      }
    }

    return {
      researchId: reportId,
      status: 'completed',
      company,
      report: validatedReport,
      sources: webData.sources,
      processingMs,
      fromCache: false,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Research pipeline failed';
    console.error('[research] Pipeline error:', errorMsg);

    // Try to mark DB record as failed (non-fatal)
    if (dbAvailable) {
      try {
        const db = await tryDb();
        if (db) {
          await db.updateResearchReport(reportId, {
            status: 'failed',
            errorMsg,
            processingMs: Date.now() - startTime,
          });
        }
      } catch { /* ignore */ }
    }

    return {
      researchId: reportId,
      status: 'failed',
      error: errorMsg,
      processingMs: Date.now() - startTime,
    };
  }
}

/**
 * Resolve company from query with local high-precision index + Groq disambiguation
 */
export async function resolveCompanyFromQuery(query: string): Promise<
  | { resolved: true; company: CompanyIdentity }
  | { resolved: false; candidates: CompanyCandidate[]; error?: string }
> {
  const result = await identifyCompany(query);
  if (result.resolved && result.company) {
    return { resolved: true, company: result.company };
  }
  return {
    resolved: false,
    candidates: result.candidates ?? [],
    error: result.error,
  };
}
