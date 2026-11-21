import type { FinancialMetric, ResearchSourceMeta, TechnicalAnalysis } from '@/types/research';
import type { CompanyIdentity } from '@/types/company';

export interface ExtractedFinancials {
  marketCap?: FinancialMetric;
  currentPrice?: number | string;
  pe?: FinancialMetric;
  pb?: FinancialMetric;
  evEbitda?: FinancialMetric;
  dividendYield?: FinancialMetric;
  roe?: FinancialMetric;
  roce?: FinancialMetric;
  debtToEquity?: FinancialMetric;
  totalDebt?: FinancialMetric;
  cash?: FinancialMetric;
  netDebt?: FinancialMetric;
  revenue?: FinancialMetric;
  ebitda?: FinancialMetric;
  netProfit?: FinancialMetric;
  eps?: FinancialMetric;
  revenueGrowth?: FinancialMetric;
  profitGrowth?: FinancialMetric;
  ebitdaMargin?: FinancialMetric;
  netMargin?: FinancialMetric;
  promoterHolding?: FinancialMetric;
  fiiHolding?: FinancialMetric;
  diiHolding?: FinancialMetric;
  publicHolding?: FinancialMetric;
  pledgedHolding?: FinancialMetric;
  shareholdingAsOf?: string;
  basis: 'Consolidated' | 'Standalone' | 'Unspecified';
  technical?: TechnicalAnalysis;
  totalAssets?: FinancialMetric;
  totalLiabilities?: FinancialMetric;
  currentAssets?: FinancialMetric;
  currentLiabilities?: FinancialMetric;
  shareholdersEquity?: FinancialMetric;
  equityCapital?: FinancialMetric;
  reserves?: FinancialMetric;
  operatingCashFlow?: FinancialMetric;
  investingCashFlow?: FinancialMetric;
  financingCashFlow?: FinancialMetric;
  freeCashFlow?: FinancialMetric;
  capex?: FinancialMetric;
  currentRatio?: FinancialMetric;
  quickRatio?: FinancialMetric;
  interestCoverage?: FinancialMetric;
  interestExpense?: FinancialMetric;
  ebit?: FinancialMetric;
  workingCapital?: FinancialMetric;
  annualTrend?: Array<{
    period: string;
    revenue?: number | string | null;
    operatingProfit?: number | string | null;
    ebitda?: number | string | null;
    profit?: number | string | null;
    eps?: number | string | null;
    sourceId?: string | null;
    basis?: string | null;
  }>;
  quarterlyTrend?: Array<{
    period: string;
    revenue?: number | string | null;
    operatingProfit?: number | string | null;
    ebitda?: number | string | null;
    profit?: number | string | null;
    eps?: number | string | null;
    sourceId?: string | null;
    basis?: string | null;
  }>;
  shareholdingHistory?: Array<{
    period: string;
    promoter?: number | null;
    fii?: number | null;
    dii?: number | null;
    public?: number | null;
    sourceId?: string | null;
    basis?: string | null;
  }>;
}

/**
 * Clean numeric string by removing commas, currency symbols, and extra spaces
 */
function parseCleanNumber(val: string): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[₹$,\s%]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Extracts regex match with groups
 */
function matchPattern(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Primary extractor: parses authoritative financial data from Screener,
 * exchange filings, and financial databases using both table-aware cell parsers
 * and robust regex fallback matchers.
 */
export function extractFinancialMetrics(params: {
  company: CompanyIdentity;
  screenerText: string;
  filingText: string;
  technicalText: string;
  sources: ResearchSourceMeta[];
}): ExtractedFinancials {
  const { screenerText, filingText, technicalText, sources } = params;
  const combined = `${screenerText}\n${filingText}`;

  // Find source IDs
  const screenerSource = sources.find((s) => s.domain.includes('screener.in')) || sources[0];
  const filingSource = sources.find((s) => s.domain.includes('bseindia.com') || s.domain.includes('nseindia.com')) || screenerSource;

  const screenerSrcId = screenerSource?.id ?? 'src_screener';
  const filingSrcId = filingSource?.id ?? 'src_filing';

  // Never infer one statement basis when the evidence corpus contains both bases.
  const lowerEvidence = combined.toLowerCase();
  const hasConsolidated = lowerEvidence.includes('consolidated');
  const hasStandalone = lowerEvidence.includes('standalone');
  const basis: ExtractedFinancials['basis'] = hasConsolidated === hasStandalone
    ? 'Unspecified'
    : hasConsolidated ? 'Consolidated' : 'Standalone';

  // Helper to parse cells from markdown table row
  const parseCells = (line: string) => line.split('|').map((s) => s.trim()).filter(Boolean);
  const findTableRow = (lines: string[], aliases: string[]) => {
    const labelled = lines.map((line) => ({ line, label: parseCells(line)[0]?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '' }));
    return labelled.find((item) => aliases.includes(item.label))?.line
      ?? labelled.find((item) => !/growth|margin|percentage|yoy/.test(item.label) && aliases.some((alias) => item.label.startsWith(`${alias} `)))?.line;
  };

  let tablePeriod: string | null = null;
  let tableSales: number | null = null;
  let tablePrevSales: number | null = null;
  let tableEbitda: number | null = null;
  let tableNetProfit: number | null = null;
  let tablePrevNetProfit: number | null = null;
  let tableEps: number | null = null;
  let tableBorrowings: number | null = null;
  let tablePromoter: number | null = null;
  let tableFii: number | null = null;
  let tableDii: number | null = null;
  let tablePublic: number | null = null;
  let tableSharePeriod: string | null = null;

  // 1. Structured Table Parser: ## Quarterly Results
  const qIdx = combined.indexOf('## Quarterly Results');
  if (qIdx !== -1) {
    const qSection = combined.slice(qIdx, qIdx + 3000);
    const qLines = qSection.split('\n').filter((l) => l.trim().startsWith('|'));
    if (qLines.length >= 3) {
      const headers = parseCells(qLines[0]);
      if (headers.length > 0) {
        tablePeriod = headers[headers.length - 1]; // e.g. Jun 2026
      }
      // Resolve rows by their labels; table positions vary by source and period.
      const salesLine = findTableRow(qLines.slice(1), ['sales', 'revenue', 'revenue from operations', 'total income']);
      const salesCells = salesLine ? parseCells(salesLine) : [];
      if (salesCells.length > 0) {
        tableSales = parseCleanNumber(salesCells[salesCells.length - 1]);
        if (salesCells.length >= 5) {
          tablePrevSales = parseCleanNumber(salesCells[salesCells.length - 5]); // 4 quarters ago for YoY
        }
      }
      const operatingLine = findTableRow(qLines.slice(1), ['operating profit', 'ebitda']);
      const opCells = operatingLine ? parseCells(operatingLine) : [];
      if (opCells.length > 0) {
        tableEbitda = parseCleanNumber(opCells[opCells.length - 1]);
      }
      const profitLine = findTableRow(qLines.slice(1), ['net profit', 'profit after tax', 'pat']);
      const npCells = profitLine ? parseCells(profitLine) : [];
      if (npCells.length > 0) {
        tableNetProfit = parseCleanNumber(npCells[npCells.length - 1]);
        if (npCells.length >= 5) {
          tablePrevNetProfit = parseCleanNumber(npCells[npCells.length - 5]);
        }
      }
      const epsLine = findTableRow(qLines.slice(1), ['eps in rs', 'eps']);
      const epsCells = epsLine ? parseCells(epsLine) : [];
      if (epsCells.length > 0) {
        tableEps = parseCleanNumber(epsCells[epsCells.length - 1]);
      }
    }
  }

  // 2. Structured Table Parser: ## Balance Sheet
  const bIdx = combined.indexOf('## Balance Sheet');
  if (bIdx !== -1) {
    const bSection = combined.slice(bIdx, bIdx + 3000);
    const bLines = bSection.split('\n').filter((l) => l.trim().startsWith('|'));
    for (const line of bLines) {
      if (line.includes('Borrowings')) {
        const cells = parseCells(line);
        if (cells.length > 0) {
          tableBorrowings = parseCleanNumber(cells[cells.length - 1]);
        }
        break;
      }
    }
    // Never infer borrowings by row position; absence remains missing.
  }

  // 3. Structured Table Parser: Shareholding Pattern
  const sMatch = combined.match(/#{1,4}\s*Shareholding(?:\s*Pattern)?/i)
    ?? combined.match(/Shareholding\s*Pattern/i);
  const sIdx = sMatch ? (sMatch.index ?? -1) : -1;
  if (sIdx !== -1) {
    const sSection = combined.slice(sIdx, sIdx + 2500);
    const sLines = sSection.split('\n').filter((l) => l.trim().startsWith('|'));
    if (sLines.length >= 2) {
      const sHeaders = parseCells(sLines[0]);
      if (sHeaders.length > 0) {
        tableSharePeriod = sHeaders[sHeaders.length - 1];
      }
      const promLine = findTableRow(sLines.slice(1), ['promoters', 'promoter', 'promoter group']);
      const promCells = promLine ? parseCells(promLine) : [];
      if (promCells.length > 0) tablePromoter = parseCleanNumber(promCells[promCells.length - 1]);

      const fiiLine = findTableRow(sLines.slice(1), ['fiis', 'fii', 'foreign', 'foreign institutions', 'foreign institutional']);
      const fiiCells = fiiLine ? parseCells(fiiLine) : [];
      if (fiiCells.length > 0) tableFii = parseCleanNumber(fiiCells[fiiCells.length - 1]);

      const diiLine = findTableRow(sLines.slice(1), ['diis', 'dii', 'domestic', 'domestic institutions', 'domestic institutional']);
      const diiCells = diiLine ? parseCells(diiLine) : [];
      if (diiCells.length > 0) tableDii = parseCleanNumber(diiCells[diiCells.length - 1]);

      const publicLine = findTableRow(sLines.slice(1), ['public', 'retail']);
      const pubCells = publicLine ? parseCells(publicLine) : [];
      if (pubCells.length > 0) tablePublic = parseCleanNumber(pubCells[pubCells.length - 1]);
    }
  }

  // 4. Valuation & Overview Ratios (Regex Matchers)
  let mcapRaw = matchPattern(combined, /Market\s*Cap(?:italization)?\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
  if (!mcapRaw) {
    mcapRaw = matchPattern(combined, /Mar\s*Cap\s*Rs\.?Cr\.?[^|]*\|\s*([0-9,.]+)/i);
  }
  const mcapVal = mcapRaw ? parseCleanNumber(mcapRaw) : null;

  const currentPriceRaw = matchPattern(combined, /(?:Current\s*Price|CMP\s*Rs\.?|CMP|Stock\s*Price)\s*[:₹\s]*([0-9,.]+)/i);
  const currentPrice = currentPriceRaw ? parseCleanNumber(currentPriceRaw) : null;

  const peRaw = matchPattern(combined, /(?:Stock\s*P\/E|P\/E\s*Ratio|PE\s*Ratio|P\/E)\s*[:\s]*([0-9,.]+)/i);
  const peVal = peRaw ? parseCleanNumber(peRaw) : null;

  const pbRaw = matchPattern(combined, /(?:P\/B\s*Ratio|Price\s*to\s*Book|P\/B)\s*[:₹\s]*([0-9,.]+)/i);
  const pbVal = pbRaw ? parseCleanNumber(pbRaw) : null;

  const roeRaw = matchPattern(combined, /ROE\s*[:\s]*([0-9,.]+)\s*%/i);
  const roeVal = roeRaw ? parseCleanNumber(roeRaw) : null;

  const roceRaw = matchPattern(combined, /ROCE\s*[:\s%]*([0-9,.]+)/i);
  const roceVal = roceRaw ? parseCleanNumber(roceRaw) : null;

  const divYieldRaw = matchPattern(combined, /(?:Dividend\s*Yield|Div\s*Yld\s*%?)\s*[:\s]*([0-9,.]+)/i);
  const divYieldVal = divYieldRaw ? parseCleanNumber(divYieldRaw) : null;

  const deRaw = matchPattern(combined, /Debt\s*(?:to|\/)\s*equity\s*[:\s]*([0-9,.]+)/i);
  const deVal = deRaw ? parseCleanNumber(deRaw) : null;

  // Debt & Cash
  const debtRaw = matchPattern(combined, /(?:Total\s*Debt|Borrowings|Debt)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
  const debtVal = tableBorrowings ?? (debtRaw ? parseCleanNumber(debtRaw) : null);

  const cashRaw = matchPattern(combined, /(?:Cash\s*(?:&|and)?\s*Equivalents?|Cash\s*Balance)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
  const cashVal = cashRaw ? parseCleanNumber(cashRaw) : null;

  // Periodic Revenue, Net Profit, EBITDA, EPS
  const quarterMatch = combined.match(/(Q[1-4]\s*FY\s*20\d{2}|Q[1-4]\s*FY\d{2}|June\s*20\d{2}|Sep\s*20\d{2}|Dec\s*20\d{2}|March\s*20\d{2})/i);
  const latestPeriod = tablePeriod || (quarterMatch ? quarterMatch[1].toUpperCase() : 'TTM');

  let revRaw = matchPattern(combined, /(?:Sales|Revenue|Total\s*Income)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
  if (!revRaw) revRaw = matchPattern(combined, /Sales\s*Qtr\s*Rs\.?Cr\.?[^|]*\|\s*([0-9,.]+)/i);
  const revVal = tableSales ?? (revRaw ? parseCleanNumber(revRaw) : null);

  let netProfitRaw = matchPattern(combined, /(?:Net\s*Profit|PAT|Profit\s*after\s*Tax)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
  if (!netProfitRaw) netProfitRaw = matchPattern(combined, /NP\s*Qtr\s*Rs\.?Cr\.?[^|]*\|\s*([0-9,.]+)/i);
  const netProfitVal = tableNetProfit ?? (netProfitRaw ? parseCleanNumber(netProfitRaw) : null);

  const ebitdaRaw = matchPattern(combined, /(?:Operating\s*Profit|EBITDA)\s*[:₹\s]*([0-9,.]+)\s*(?:Cr|Crore)?/i);
  const ebitdaVal = tableEbitda ?? (ebitdaRaw ? parseCleanNumber(ebitdaRaw) : null);

  const epsRaw = matchPattern(combined, /EPS(?:\s*in\s*Rs)?\s*[:₹\s]*([0-9,.]+)/i);
  const epsVal = tableEps ?? (epsRaw ? parseCleanNumber(epsRaw) : null);

  // Shareholding
  const promoterRaw = matchPattern(combined, /(?:Promoter[s']?(?:\s*group|\s*holding)?|Promoters?)\s*[:|–—-]?\s*([0-9,.]+)\s*%?/i);
  const promoterTableMatch = matchPattern(combined, /\|\s*Promoters?\s*\|\s*([0-9,.]+)/i);
  const promoterScreener = matchPattern(combined, /^[|#\s]*promoters?\s+(\d+\.?\d*)\s/im);
  const promoterVal = tablePromoter
    ?? (promoterTableMatch ? parseCleanNumber(promoterTableMatch) : null)
    ?? (promoterRaw ? parseCleanNumber(promoterRaw) : null)
    ?? (promoterScreener ? parseCleanNumber(promoterScreener) : null);

  const fiiRaw = matchPattern(combined, /(?:FII[s']?(?:\s*holding|\/\s*FPI)?|Foreign\s*Institutional)\s*[:|–—-]?\s*([0-9,.]+)\s*%?/i);
  const fiiTableMatch = matchPattern(combined, /\|\s*(?:FIIs?|FPIs?)\s*\|\s*([0-9,.]+)/i);
  const fiiScreener = matchPattern(combined, /^[|#\s]*(?:fiis?|foreign\s+institutional)\s+(\d+\.?\d*)\s/im);
  const fiiVal = tableFii
    ?? (fiiTableMatch ? parseCleanNumber(fiiTableMatch) : null)
    ?? (fiiRaw ? parseCleanNumber(fiiRaw) : null)
    ?? (fiiScreener ? parseCleanNumber(fiiScreener) : null);

  const diiRaw = matchPattern(combined, /(?:DII[s']?(?:\s*holding)?|Domestic\s*Institutional)\s*[:|–—-]?\s*([0-9,.]+)\s*%?/i);
  const diiTableMatch = matchPattern(combined, /\|\s*DIIs?\s*\|\s*([0-9,.]+)/i);
  const diiScreener = matchPattern(combined, /^[|#\s]*(?:diis?|domestic\s+institutional)\s+(\d+\.?\d*)\s/im);
  const diiVal = tableDii
    ?? (diiTableMatch ? parseCleanNumber(diiTableMatch) : null)
    ?? (diiRaw ? parseCleanNumber(diiRaw) : null)
    ?? (diiScreener ? parseCleanNumber(diiScreener) : null);

  const publicRaw = matchPattern(combined, /(?:Public(?:\s*holding|\s*shareholders?)?|Retail)\s*[:|–—-]?\s*([0-9,.]+)\s*%?/i);
  const publicTableMatch = matchPattern(combined, /\|\s*Public\s*\|\s*([0-9,.]+)/i);
  const publicScreener = matchPattern(combined, /^[|#\s]*public\s+(\d+\.?\d*)\s/im);
  const publicVal = tablePublic
    ?? (publicTableMatch ? parseCleanNumber(publicTableMatch) : null)
    ?? (publicRaw ? parseCleanNumber(publicRaw) : null)
    ?? (publicScreener ? parseCleanNumber(publicScreener) : null);

  const pledgedRaw = matchPattern(combined, /(?:Pledged(?:\s*percentage|\s*shares)?|Promoter(?:s)?\s+Pledge[sd]?)\s*[:|–—-]?\s*([0-9,.]+)\s*%/i);
  const pledgedVal = pledgedRaw ? parseCleanNumber(pledgedRaw) : 0;

  // 5. Deterministic Derived Calculations
  // Revenue Growth YoY %
  let revenueGrowth: FinancialMetric | undefined;
  if (tableSales && tablePrevSales && tablePrevSales > 0) {
    const growth = (((tableSales - tablePrevSales) / tablePrevSales) * 100).toFixed(1);
    revenueGrowth = {
      value: growth,
      unit: '%',
      period: latestPeriod,
      basis,
      sourceId: screenerSrcId,
      metricType: 'calculated',
      formula: '(Current Revenue - Previous Year Revenue) / Previous Year Revenue * 100',
    };
  }

  // PAT Growth YoY %
  let profitGrowth: FinancialMetric | undefined;
  if (tableNetProfit && tablePrevNetProfit && tablePrevNetProfit > 0) {
    const pGrowth = (((tableNetProfit - tablePrevNetProfit) / tablePrevNetProfit) * 100).toFixed(1);
    profitGrowth = {
      value: pGrowth,
      unit: '%',
      period: latestPeriod,
      basis,
      sourceId: screenerSrcId,
      metricType: 'calculated',
      formula: '(Current PAT - Previous Year PAT) / Previous Year PAT * 100',
    };
  }

  // EBITDA Margin %
  let ebitdaMargin: FinancialMetric | undefined;
  if (ebitdaVal && revVal && revVal > 0) {
    const margin = ((ebitdaVal / revVal) * 100).toFixed(1);
    ebitdaMargin = {
      value: margin,
      unit: '%',
      period: latestPeriod,
      basis,
      sourceId: screenerSrcId,
      metricType: 'calculated',
      formula: 'EBITDA / Revenue * 100',
    };
  }

  // Net Profit Margin %
  let netMargin: FinancialMetric | undefined;
  if (netProfitVal && revVal && revVal > 0) {
    const nm = ((netProfitVal / revVal) * 100).toFixed(1);
    netMargin = {
      value: nm,
      unit: '%',
      period: latestPeriod,
      basis,
      sourceId: screenerSrcId,
      metricType: 'calculated',
      formula: 'Net Profit / Revenue * 100',
    };
  }

  // Net Debt = Total Debt - Cash
  let netDebt: FinancialMetric | undefined;
  if (debtVal !== null) {
    const cashAmount = cashVal ?? 0;
    const nd = Math.round(debtVal - cashAmount);
    netDebt = {
      value: nd,
      unit: '₹ Cr',
      period: latestPeriod,
      basis,
      sourceId: screenerSrcId,
      metricType: 'calculated',
      formula: 'Total Debt - Cash & Equivalents',
    };
  }

  // 6. Technical Analysis
  const combinedTech = `${technicalText}\n${screenerText}`;
  const high52Raw = matchPattern(combinedTech, /(?:52\s*W(?:eek)?\s*High|High\s*\/\s*Low)\s*[:₹\s]*([0-9,.]+)/i);
  const low52Raw = matchPattern(combinedTech, /(?:52\s*W(?:eek)?\s*Low|\/\s*Low)\s*[:₹\s]*([0-9,.]+)/i);
  const rsiRaw = matchPattern(combinedTech, /RSI\s*(?:\(14\))?\s*[:\s]*([0-9,.]+)/i);
  const sma50Raw = matchPattern(combinedTech, /(?:50\s*DMA|50\s*SMA|50\s*day\s*MA)\s*[:₹\s]*([0-9,.]+)/i);
  const sma200Raw = matchPattern(combinedTech, /(?:200\s*DMA|200\s*SMA|200\s*day\s*MA)\s*[:₹\s]*([0-9,.]+)/i);

  const technical: TechnicalAnalysis = {
    price: currentPrice,
    high52W: high52Raw ? parseCleanNumber(high52Raw) : null,
    low52W: low52Raw ? parseCleanNumber(low52Raw) : null,
    sma50: sma50Raw ? parseCleanNumber(sma50Raw) : null,
    sma200: sma200Raw ? parseCleanNumber(sma200Raw) : null,
    rsi: rsiRaw ? parseCleanNumber(rsiRaw) : null,
    trend: currentPrice && sma200Raw && currentPrice > (parseCleanNumber(sma200Raw) || 0) ? 'Bullish' : 'Neutral',
    observations: currentPrice && high52Raw ? `Trading near ₹${currentPrice} against 52-week high of ₹${high52Raw}.` : undefined,
  };

  return {
    basis,
    marketCap: mcapVal ? { value: mcapVal, unit: '₹ Cr', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    currentPrice: currentPrice ?? undefined,
    pe: peVal ? { value: peVal, unit: 'x', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    pb: pbVal ? { value: pbVal, unit: 'x', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    dividendYield: divYieldVal !== null ? { value: divYieldVal, unit: '%', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    roe: roeVal !== null ? { value: roeVal, unit: '%', period: 'FY2024-25', basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    roce: roceVal !== null ? { value: roceVal, unit: '%', period: 'FY2024-25', basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    debtToEquity: deVal !== null ? { value: deVal, unit: '', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    totalDebt: debtVal !== null ? { value: debtVal, unit: '₹ Cr', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    cash: cashVal !== null ? { value: cashVal, unit: '₹ Cr', period: latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    netDebt,
    revenue: revVal !== null ? { value: revVal, unit: '₹ Cr', period: latestPeriod, basis, sourceId: tableSales !== null ? screenerSrcId : filingSrcId, metricType: 'reported' } : undefined,
    ebitda: ebitdaVal !== null ? { value: ebitdaVal, unit: '₹ Cr', period: latestPeriod, basis, sourceId: tableEbitda !== null ? screenerSrcId : filingSrcId, metricType: 'reported' } : undefined,
    netProfit: netProfitVal !== null ? { value: netProfitVal, unit: '₹ Cr', period: latestPeriod, basis, sourceId: tableNetProfit !== null ? screenerSrcId : filingSrcId, metricType: 'reported' } : undefined,
    eps: epsVal !== null ? { value: epsVal, unit: '₹', period: latestPeriod, basis, sourceId: tableEps !== null ? screenerSrcId : filingSrcId, metricType: 'reported' } : undefined,
    revenueGrowth,
    profitGrowth,
    ebitdaMargin,
    netMargin,
    promoterHolding: promoterVal !== null ? { value: promoterVal, unit: '%', period: tableSharePeriod || latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    fiiHolding: fiiVal !== null ? { value: fiiVal, unit: '%', period: tableSharePeriod || latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    diiHolding: diiVal !== null ? { value: diiVal, unit: '%', period: tableSharePeriod || latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    publicHolding: publicVal !== null ? { value: publicVal, unit: '%', period: tableSharePeriod || latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    pledgedHolding: pledgedVal !== null ? { value: pledgedVal, unit: '%', period: tableSharePeriod || latestPeriod, basis, sourceId: screenerSrcId, metricType: 'reported' } : undefined,
    shareholdingAsOf: tableSharePeriod || undefined,
    technical,
  };
}
