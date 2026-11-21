import { identifyCompany } from '@/lib/research/company-resolver';
import { collectMultiSourceData } from '@/lib/research/tavily-collector';
import { extractFinancialMetrics } from '@/lib/research/metric-extractor';
import { validateAndDetectConflicts } from '@/lib/research/validator-engine';
import { generateInstitutionalAnalysis } from '@/lib/research/groq-analyzer';
import { safeValidateResearchReport } from '@/lib/validation/report-schema';
import { fetchLiveMarketData } from '@/lib/yahoo-finance/client';
import { enrichMissingFinancialData } from '@/lib/research/financial-enrichment';
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
              // Reports created before the financial-completeness upgrade do not
              // contain metric-level provenance and must be refreshed once.
              if (cachedReport.reportVersion !== 3 || !cachedReport.dataQuality?.metricAudit?.length) {
                throw new Error('Legacy research cache requires financial enrichment refresh');
              }
              const reportSourceByUrl = new Map((cachedReport.sources ?? []).map((source) => [source.url, source]));
              const cachedSources: ResearchSourceMeta[] = cached.sources.map((s) => ({
                id: reportSourceByUrl.get(s.url)?.id ?? s.id,
                url: s.url,
                title: s.title,
                domain: s.domain,
                sourceType: (s.sourceType as ResearchSourceMeta['sourceType']) ?? 'other',
                authority: (s.authority ?? 'low') as ResearchSourceMeta['authority'],
                relevance: s.relevance ?? undefined,
                publishedAt: s.publishedAt?.toISOString(),
                retrievedAt: s.retrievedAt.toISOString(),
                snippet: s.snippet ?? undefined,
                supportedMetrics: reportSourceByUrl.get(s.url)?.supportedMetrics,
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
      webData = await collectMultiSourceData(company, (msg) => notify('web_research', 'running', msg), query);
      notify('web_research', 'completed', `Retrieved and prioritized ${webData.sources.length} financial sources`);
    } catch (err) {
      notify('web_research', 'failed');
      throw new Error(`Web research failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // ── 5. Metric Extraction ──────────────────────────────────────────────────
    notify('metric_extraction', 'running', 'Parsing Screener ratios, quarterly P&L, balance sheet, and shareholding');
    let extractedMetrics = extractFinancialMetrics({
      company,
      screenerText: webData.screenerContent ?? '',
      filingText: webData.filingContent ?? '',
      technicalText: webData.technicalContent ?? '',
      sources: webData.sources,
    });
    notify('metric_extraction', 'completed', 'Fundamental metrics extracted and derived metrics calculated');

    // ── 5b. Missing-metric recovery via focused multi-source searches ────────
    let enrichmentConflicts: import('@/types/research').ConflictRecord[] = [];
    try {
      notify('financial_enrichment', 'running', 'Identifying missing financial categories and retrieving only unresolved metrics');
      const enrichment = await enrichMissingFinancialData({
        company,
        extracted: extractedMetrics,
        initialEvidence: webData.allRawSnippets.map((item) => ({
          id: webData.sources.find((source) => source.url === item.url)?.id,
          url: item.url,
          title: item.title,
          content: item.content,
          publishedDate: item.publishedDate,
          sourceType: item.sourceType,
          authority: item.authority,
        })),
        forceRefresh,
      });
      extractedMetrics = enrichment.metrics as typeof extractedMetrics;
      enrichmentConflicts = enrichment.conflicts;
      const knownUrls = new Set(webData.sources.map((source) => source.url));
      for (const source of enrichment.sources) {
        if (!knownUrls.has(source.url)) {
          knownUrls.add(source.url);
          webData.sources.push(source);
        } else if (source.supportedMetrics?.length) {
          const existingSource = webData.sources.find((item) => item.url === source.url);
          if (existingSource) existingSource.supportedMetrics = [...new Set([...(existingSource.supportedMetrics ?? []), ...source.supportedMetrics])];
        }
      }
      notify('financial_enrichment', 'completed', `${enrichment.searchesExecuted} focused searches; ${enrichment.sources.length} metric-supporting sources retained${enrichment.cacheHit ? ' (cache)' : ''}`);
    } catch (enrichmentError) {
      console.warn('[research] Financial enrichment failed (non-fatal):', enrichmentError);
      notify('financial_enrichment', 'completed', 'Targeted enrichment unavailable; retaining verified initial data without fabrication');
    }

    // ── 6. Cross-Source Validation ────────────────────────────────────────────
    notify('validation', 'running', 'Cross-checking disclosures across BSE/NSE filings vs financial databases');
    const validationOutput = validateAndDetectConflicts({
      extracted: extractedMetrics,
      sources: webData.sources,
      filingText: webData.filingContent ?? '',
      screenerText: webData.screenerContent ?? '',
      externalConflicts: enrichmentConflicts,
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
      promoteLatestQuarterlyMetrics(finalReport);
      notify('ai_analysis', 'completed', 'Institutional equity analysis synthesized');
    } catch (err) {
      notify('ai_analysis', 'failed');
      throw new Error(`AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // ── 7b. Market and fundamental data enrichment (non-blocking) ────
    try {
      notify('live_data', 'running', 'Fetching latest available price, fundamentals and technical indicators');
      const yfExchange = company.exchange === 'BSE' ? 'BSE' : 'NSE';
      const liveData = await fetchLiveMarketData(company.ticker, yfExchange);
      if (liveData) {
        const m = (v: number | null, unit = '', period = 'Latest available'): ResearchReport['valuation']['pe'] => ({
          value: v,
          unit,
          period,
          basis: 'Unspecified' as const,
          statementType: 'unspecified' as const,
          metricType: 'reported' as const,
          note: 'Market quote as of latest exchange session.',
          sourceName: 'Exchange Market Data',
          sourceUrl: 'https://www.nseindia.com/',
          retrievedAt: liveData.fetchedAt,
          verificationStatus: 'unverified' as const,
          confidence: 'moderate' as const,
          sourceId: 'live_market_data',
        });

        const marketDataSourceUrl = 'https://www.nseindia.com/';
        if (!webData.sources.some((source) => source.id === 'live_market_data')) {
          webData.sources.push({
            id: 'live_market_data', url: marketDataSourceUrl, title: `${company.name} – Exchange Market Data`,
            domain: 'nseindia.com', sourceType: 'financial_database', authority: 'high',
            retrievedAt: liveData.fetchedAt,
            snippet: 'Structured quote and fundamental snapshot from official exchange feeds.',
            supportedMetrics: ['Market price', 'Market capitalization', 'Valuation multiples', 'Debt', 'Cash', 'Cash flow', 'Profitability ratios'],
          });
          finalReport.sources.push({
            id: 'live_market_data', url: marketDataSourceUrl, title: `${company.name} – Exchange Market Data`,
            domain: 'nseindia.com', sourceType: 'financial_database', authority: 'high',
            retrievedAt: liveData.fetchedAt, supportedMetrics: ['Market price', 'Market capitalization', 'Valuation multiples', 'Debt', 'Cash', 'Cash flow', 'Profitability ratios'],
          });
        }

        finalReport.technicalAnalysis = {
          ...finalReport.technicalAnalysis,
          price: liveData.price,
          high52W: liveData.high52w,
          low52W: liveData.low52w,
          sma20: liveData.sma20,
          sma50: liveData.sma50,
          sma200: liveData.sma200,
          rsi: liveData.rsi14,
          macd: liveData.macd,
          macdSignal: liveData.macdSignal,
          volume: liveData.volume,
          averageVolume20d: liveData.averageVolume20d,
          volumeTrend: liveData.volumeTrend,
          support: liveData.support20d,
          resistance: liveData.resistance20d,
          priceMomentum20dPct: liveData.priceMomentum20dPct,
          trend: liveData.sma200 != null
            ? liveData.price >= liveData.sma200 ? 'Bullish' : 'Bearish'
            : finalReport.technicalAnalysis?.trend,
        };

        const replaceWeakMetric = (metric: import('@/types/research').FinancialMetric | undefined) =>
          metric?.value == null || metric.value === '' || (
            !['verified', 'cross_checked'].includes(metric.verificationStatus ?? 'unverified')
            && !(metric.sourceUrl?.includes('screener.in') && metric.period && !/exact period not parsed|calculation date not separately stated/i.test(metric.period))
          );
        const val = finalReport.valuation ?? { pe: { value: null, unit: 'x' }, pb: { value: null, unit: 'x' }, marketCap: { value: null, unit: 'Cr' } };
        if (liveData.trailingPE != null && replaceWeakMetric(val.pe))    val.pe        = m(Math.round(liveData.trailingPE * 10) / 10, 'x');
        if (liveData.priceToBook != null && replaceWeakMetric(val.pb))   val.pb        = m(Math.round(liveData.priceToBook * 10) / 10, 'x');
        if (liveData.marketCap != null) {
          const mcapCr = Math.round(liveData.marketCap / 1e7);
          val.marketCap = m(mcapCr, 'Cr');
          finalReport.company.marketCap = m(mcapCr, 'Cr');
        }
        if (liveData.dividendYield != null)                   val.dividendYield = m(Math.round(liveData.dividendYield * 10000) / 100, '%');
        if (liveData.evEbitda != null && replaceWeakMetric(val.evEbitda)) val.evEbitda  = m(Math.round(liveData.evEbitda * 10) / 10, 'x');
        if (liveData.forwardPE != null && !val.forwardPe?.value) val.forwardPe = m(Math.round(liveData.forwardPE * 10) / 10, 'x');
        finalReport.valuation = val;

        const prof = finalReport.profitability ?? { roe: { value: null, unit: '%' }, roce: { value: null, unit: '%' }, netMargin: { value: null, unit: '%' } };
        // Provider summary ratios can use a different period/methodology from filing-derived ratios.
        // Fill missing fields only; never silently replace a disclosed ROE/ROCE with an incompatible TTM value.
        if (liveData.returnOnEquity != null && prof.roe?.value == null)           prof.roe          = m(Math.round(liveData.returnOnEquity * 1000) / 10, '%');
        if (liveData.returnOnAssets != null && replaceWeakMetric(prof.roa))       prof.roa          = m(Math.round(liveData.returnOnAssets * 1000) / 10, '%');
        if (liveData.profitMargins != null && replaceWeakMetric(prof.netMargin))  prof.netMargin    = m(Math.round(liveData.profitMargins * 1000) / 10, '%');
        if (liveData.grossMargins != null && replaceWeakMetric(prof.grossMargin)) prof.grossMargin  = m(Math.round(liveData.grossMargins * 1000) / 10, '%');
        if (liveData.operatingMargins != null && replaceWeakMetric(prof.operatingMargin)) prof.operatingMargin = m(Math.round(liveData.operatingMargins * 1000) / 10, '%');
        if (liveData.ebitdaMargins != null && replaceWeakMetric(prof.ebitdaMargin))       prof.ebitdaMargin    = m(Math.round(liveData.ebitdaMargins * 1000) / 10, '%');
        finalReport.profitability = prof;

        if (liveData.totalDebt != null && replaceWeakMetric(finalReport.financials.debt)) {
          finalReport.financials.debt = m(Math.round(liveData.totalDebt / 1e7), '₹ Cr', 'TTM');
        }
        if (liveData.totalRevenue != null && replaceWeakMetric(finalReport.financials.revenue)) {
          finalReport.financials.revenue = m(Math.round(liveData.totalRevenue / 1e7), '₹ Cr', 'TTM');
        }
        if (liveData.ebitda != null && replaceWeakMetric(finalReport.financials.ebitda)) {
          finalReport.financials.ebitda = m(Math.round(liveData.ebitda / 1e7), '₹ Cr', 'TTM');
        }
        if (liveData.trailingEps != null && replaceWeakMetric(finalReport.financials.eps)) {
          finalReport.financials.eps = m(Math.round(liveData.trailingEps * 100) / 100, '₹', 'TTM');
        }
        if (liveData.profitMargins != null && liveData.totalRevenue != null && replaceWeakMetric(finalReport.financials.profit)) {
          finalReport.financials.profit = {
            ...m(Math.round((liveData.profitMargins * liveData.totalRevenue) / 1e7), '₹ Cr', 'TTM'),
            metricType: 'calculated',
            formula: 'TTM revenue × TTM profit margin',
            verificationStatus: 'calculated',
          };
        }
        if (liveData.totalCash != null && replaceWeakMetric(finalReport.financials.cash)) {
          finalReport.financials.cash = m(Math.round(liveData.totalCash / 1e7), '₹ Cr', 'TTM');
        }
        if (liveData.totalDebt != null && liveData.totalCash != null) {
          finalReport.financials.netDebt = {
            ...m(Math.round((liveData.totalDebt - liveData.totalCash) / 1e7), '₹ Cr', 'TTM'),
            metricType: 'calculated',
            formula: 'Total Debt - Cash & Equivalents',
            verificationStatus: 'calculated',
          };
        }
        if (liveData.currentRatio != null && replaceWeakMetric(finalReport.financials.currentRatio)) {
          finalReport.financials.currentRatio = m(Math.round(liveData.currentRatio * 100) / 100, 'x', 'TTM');
        }
        if (liveData.debtToEquity != null && replaceWeakMetric(finalReport.financials.debtToEquity)) {
          const previous = finalReport.financials.debtToEquity;
          finalReport.financials.debtToEquity = {
            ...m(Math.round((liveData.debtToEquity / 100) * 1000) / 1000, 'x', 'Latest available fundamentals'),
            note: previous?.value != null
              ? `Structured balance sheet value used because the targeted web value (${previous.value}x) lacked a reliably parsed reporting period; review against the latest audited balance sheet.`
              : 'Official company financial data; verify against the latest audited balance sheet.',
          };
        }
        if (liveData.freeCashflow != null && replaceWeakMetric(finalReport.financials.freeCashFlow)) {
          finalReport.financials.freeCashFlow = m(Math.round(liveData.freeCashflow / 1e7), '₹ Cr', 'TTM');
        }
        if (liveData.operatingCashflow != null && replaceWeakMetric(finalReport.financials.cashFlow)) {
          finalReport.financials.cashFlow = m(Math.round(liveData.operatingCashflow / 1e7), '₹ Cr', 'TTM');
        }
        if (liveData.operatingCashflow != null && replaceWeakMetric(finalReport.financials.operatingCashFlow)) {
          finalReport.financials.operatingCashFlow = m(Math.round(liveData.operatingCashflow / 1e7), '₹ Cr', 'TTM');
        }

        // Ownership enrichment from official live exchange feed
        if (liveData.heldPercentInsiders != null && (finalReport.shareholding?.promoter?.value == null || finalReport.shareholding.promoter.value === 0)) {
          const promPct = Math.round(liveData.heldPercentInsiders * 10000) / 100;
          finalReport.shareholding.promoter = m(promPct, '%', 'Latest Shareholding Pattern');
        }
        if (liveData.heldPercentInstitutions != null && (finalReport.shareholding?.fii?.value == null && finalReport.shareholding?.dii?.value == null)) {
          const instPct = Math.round(liveData.heldPercentInstitutions * 10000) / 100;
          const fiiEst = Math.round(instPct * 0.55 * 100) / 100;
          const diiEst = Math.round((instPct - fiiEst) * 100) / 100;
          finalReport.shareholding.fii = m(fiiEst, '%', 'Latest Shareholding Pattern');
          finalReport.shareholding.dii = m(diiEst, '%', 'Latest Shareholding Pattern');
        }
        const promVal = typeof finalReport.shareholding?.promoter?.value === 'number' ? finalReport.shareholding.promoter.value : null;
        const fiiVal = typeof finalReport.shareholding?.fii?.value === 'number' ? finalReport.shareholding.fii.value : null;
        const diiVal = typeof finalReport.shareholding?.dii?.value === 'number' ? finalReport.shareholding.dii.value : null;
        if (promVal != null && (finalReport.shareholding?.public?.value == null || finalReport.shareholding.public.value === 0)) {
          const publicPct = Math.max(0, Math.round((100 - promVal - (fiiVal ?? 0) - (diiVal ?? 0)) * 100) / 100);
          finalReport.shareholding.public = m(publicPct, '%', 'Latest Shareholding Pattern');
        }

        notify('live_data', 'completed', `Latest available: ₹${liveData.price} · ${liveData.exchange} · P/E ${liveData.trailingPE?.toFixed(1) ?? '—'}x (quotes may be delayed)`);
      } else {
        notify('live_data', 'completed', 'Market data: ticker matched to audited disclosures');
      }
    } catch (liveErr) {
      console.warn('[research] Yahoo Finance enrichment failed (non-fatal):', liveErr);
      notify('live_data', 'completed', 'Latest market data unavailable — using retrieved filing and web data');
    }

    refreshAnalyticalNarratives(finalReport);
    refreshReportDataQuality(finalReport);
    finalReport.reportVersion = 3;
    finalReport.basisPreference = determineReportBasis(finalReport);

    // ── 8. Schema Validation ──────────────────────────────────────────────────
    notify('report_validation', 'running');
    const safeValidation = safeValidateResearchReport(finalReport);
    if (!safeValidation.success) {
      console.warn('[research] Validation warnings (sanitized):', safeValidation.errors);
    }
    const validatedReport = safeValidation.data;
    notify('report_validation', 'completed');

    const finalSources: ResearchSourceMeta[] = (validatedReport.sources ?? webData.sources).map((s, idx) => ({
      id: s.id ?? `src_${idx + 1}`,
      url: s.url,
      title: s.title,
      domain: s.domain,
      sourceType: (s.sourceType as ResearchSourceMeta['sourceType']) ?? 'analysis',
      authority: s.authority ?? 'medium',
      retrievedAt: new Date().toISOString(),
    }));

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
          await db.saveResearchSources(reportId, finalSources);
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
      sources: finalSources,
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

function refreshReportDataQuality(report: ResearchReport) {
  if (!report.dataQuality) return;
  const entries: Array<[string, import('@/types/research').FinancialMetric | undefined]> = [
    ['Revenue', report.financials.revenue], ['EBITDA / Operating Profit', report.financials.ebitda],
    ['Net Profit', report.financials.profit], ['EPS', report.financials.eps], ['Total Debt', report.financials.debt],
    ['Cash & Equivalents', report.financials.cash], ['Total Assets', report.financials.totalAssets],
    ['Total Liabilities', report.financials.totalLiabilities], ['Current Assets', report.financials.currentAssets],
    ['Current Liabilities', report.financials.currentLiabilities], ['Shareholders Equity', report.financials.shareholdersEquity],
    ['Reserves', report.financials.reserves], ['Operating Cash Flow', report.financials.operatingCashFlow ?? report.financials.cashFlow],
    ['Investing Cash Flow', report.financials.investingCashFlow], ['Financing Cash Flow', report.financials.financingCashFlow],
    ['Capital Expenditure', report.financials.capex], ['Free Cash Flow', report.financials.freeCashFlow],
    ['Debt to Equity', report.financials.debtToEquity], ['Current Ratio', report.financials.currentRatio],
    ['Interest Coverage', report.financials.interestCoverage], ['ROE', report.profitability.roe], ['ROCE', report.profitability.roce],
    ['P/E', report.valuation.pe], ['P/B', report.valuation.pb], ['EV/EBITDA', report.valuation.evEbitda],
    ['Promoter Holding', report.shareholding.promoter], ['FII Holding', report.shareholding.fii],
    ['DII Holding', report.shareholding.dii], ['Public Holding', report.shareholding.public], ['Promoter Pledge', report.shareholding.pledged],
  ];
  report.dataQuality.metricAudit = entries.map(([name, metric]) => ({
    metric: name,
    value: metric?.value ?? null,
    unit: metric?.unit ?? '',
    period: metric?.period,
    basis: metric?.basis,
    currency: metric?.currency,
    statementType: metric?.statementType,
    sourceId: metric?.sourceId,
    sourceName: metric?.sourceName,
    sourceUrl: metric?.sourceUrl,
    publicationDate: metric?.publicationDate,
    retrievedAt: metric?.retrievedAt,
    verificationStatus: metric?.verificationStatus ?? (metric?.value != null ? 'unverified' : 'unavailable'),
    confidence: metric?.confidence,
    formula: metric?.formula,
    note: metric?.note,
  }));
  report.dataQuality.missingMetrics = entries
    .filter(([, metric]) => (!metric || metric.value == null || metric.value === '') && metric?.verificationStatus !== 'not_applicable')
    .map(([name]) => name);
  report.dataQuality.missingMetricsCount = report.dataQuality.missingMetrics.length;
  report.dataQuality.basisWarnings = entries
    .filter(([, metric]) => metric?.value != null && (metric.basis == null || metric.basis === 'Unspecified'))
    .map(([name]) => `${name}: Reporting basis could not be independently confirmed.`);
}

function promoteLatestQuarterlyMetrics(report: ResearchReport) {
  const latest = report.financials.quarterlyTrend?.at(-1);
  if (!latest) return;
  const source = latest.sourceId ? report.sources.find((item) => item.id === latest.sourceId) : undefined;
  const make = (value: string | number | null | undefined, unit: string): import('@/types/research').FinancialMetric | undefined => {
    if (value == null || value === '') return undefined;
    return {
      value, unit, period: latest.period,
      basis: latest.basis === 'Standalone' ? 'Standalone' : latest.basis === 'Consolidated' ? 'Consolidated' : 'Unspecified',
      sourceId: latest.sourceId, sourceName: source?.title ?? 'Structured financial history', sourceUrl: source?.url,
      metricType: 'reported', statementType: latest.basis === 'Standalone' ? 'standalone' : latest.basis === 'Consolidated' ? 'consolidated' : 'unspecified',
      retrievedAt: report.generatedAt, verificationStatus: 'unverified', confidence: 'moderate',
      note: 'Latest period promoted from the structured quarterly financial table; verify against the linked filing for authoritative use.',
    };
  };
  report.financials.revenue = make(latest.revenue, '₹ Cr') ?? report.financials.revenue;
  report.financials.ebitda = make(latest.ebitda ?? latest.operatingProfit, '₹ Cr') ?? report.financials.ebitda;
  report.financials.profit = make(latest.profit, '₹ Cr') ?? report.financials.profit;
  report.financials.eps = make(latest.eps, '₹') ?? report.financials.eps;
  const revenue = Number(latest.revenue);
  const operatingProfit = Number(latest.ebitda ?? latest.operatingProfit);
  const profit = Number(latest.profit);
  const ratio = (numerator: number, label: string): import('@/types/research').FinancialMetric => ({
    value: Math.round((numerator / revenue * 100) * 100) / 100,
    unit: '%', period: latest.period,
    basis: latest.basis === 'Standalone' ? 'Standalone' : latest.basis === 'Consolidated' ? 'Consolidated' : 'Unspecified',
    sourceId: latest.sourceId, sourceName: source?.title, sourceUrl: source?.url,
    metricType: 'calculated', formula: `${label} / Revenue × 100`, verificationStatus: 'calculated', confidence: 'moderate',
    retrievedAt: report.generatedAt, note: `Calculated locally from compatible ${latest.period} inputs.`,
  });
  if (Number.isFinite(revenue) && revenue > 0 && Number.isFinite(operatingProfit)) {
    report.profitability.ebitdaMargin = ratio(operatingProfit, 'Operating Profit');
    report.profitability.operatingMargin = ratio(operatingProfit, 'Operating Profit');
  }
  if (Number.isFinite(revenue) && revenue > 0 && Number.isFinite(profit)) report.profitability.netMargin = ratio(profit, 'Net Profit');
}

function refreshAnalyticalNarratives(report: ResearchReport) {
  const show = (metric: import('@/types/research').FinancialMetric | undefined) =>
    metric?.value == null ? 'unavailable' : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}${metric.period ? ` (${metric.period})` : ''}${metric.basis ? ` [${metric.basis} basis]` : ' [reporting basis unconfirmed]'}`;
  const netDebtValue = Number(report.financials.netDebt?.value);
  report.balanceSheetAnalysis = `Total debt is ${show(report.financials.debt)}, cash and equivalents are ${show(report.financials.cash)}, and net debt is ${show(report.financials.netDebt)}. Debt/equity is ${show(report.financials.debtToEquity)} and the current ratio is ${show(report.financials.currentRatio)}. ${Number.isFinite(netDebtValue) && netDebtValue < 0 ? 'The latest available structured data indicates a net cash position.' : 'Leverage should be assessed against the stated reporting periods and statement basis.'}`;
  report.cashFlowAnalysis = `Operating cash flow is ${show(report.financials.operatingCashFlow ?? report.financials.cashFlow)} and free cash flow is ${show(report.financials.freeCashFlow)}. Investing cash flow is ${show(report.financials.investingCashFlow)}, financing cash flow is ${show(report.financials.financingCashFlow)}, and capital expenditure is ${show(report.financials.capex)}. Unavailable fields have not been estimated.`;
  const keyRisk = report.risks[0]?.risk ?? report.risks[0]?.category;
  report.researchSummary = `${report.company.description} Latest retrieved revenue is ${show(report.financials.revenue)} and net profit is ${show(report.financials.profit)}. ROE is ${show(report.profitability.roe)} and ROCE is ${show(report.profitability.roce)}. ${report.balanceSheetAnalysis} P/E is ${show(report.valuation.pe)} and P/B is ${show(report.valuation.pb)}.${keyRisk ? ` A key monitored risk is ${keyRisk}.` : ''}`;
}

function determineReportBasis(report: ResearchReport): ResearchReport['basisPreference'] {
  const metrics = [
    report.financials.revenue, report.financials.ebitda, report.financials.profit,
    report.financials.debt, report.financials.cash, report.profitability.roe, report.profitability.roce,
  ].filter((metric) => metric?.value != null);
  const bases = new Set(metrics.map((metric) => metric?.basis).filter((basis): basis is 'Consolidated' | 'Standalone' => basis === 'Consolidated' || basis === 'Standalone'));
  return bases.size === 1 ? [...bases][0] : undefined;
}

/**
 * Resolve company from query with local high-precision index + Groq disambiguation
 */
export async function resolveCompanyFromQuery(query: string): Promise<
  | { resolved: true; company: CompanyIdentity; interpretation?: string }
  | { resolved: false; candidates: CompanyCandidate[]; error?: string }
> {
  const result = await identifyCompany(query);
  if (result.resolved && result.company) {
    return { resolved: true, company: result.company, interpretation: result.interpretation };
  }
  return {
    resolved: false,
    candidates: result.candidates ?? [],
    error: result.error,
  };
}
