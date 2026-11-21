import type { InvestmentHorizon, InvestorPositionInput } from '@/types/decision';

export function extractInvestorPosition(query: string): InvestorPositionInput {
  const lower = query.toLowerCase();
  const purchasePrice = extractAmount(query, /(?:bought|purchased|average(?:d)?|entry|buy(?:ing)?(?:\s+at)?|purchase\s+price)\s*(?:at|price|of|is|=|:)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const quantityMatch = query.match(/(?:quantity|qty|shares?|units?)\s*(?:is|=|:|of)?\s*(\d+)/i);
  const riskMatch = query.match(/(?:risk|acceptable risk|risk tolerance)\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const capital = extractAmount(query, /(?:capital|available capital|invest(?:ment)?(?: amount)?|i have|allocate)\s*(?:is|=|:|of)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const accountEquity = extractAmount(query, /(?:account equity|account size|trading account|portfolio value)\s*(?:is|=|:|of)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const dailyLoss = extractAmount(query, /(?:maximum|max)\s+daily\s+loss\s*(?:is|=|:|of)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const currentDailyLoss = extractAmount(query, /(?:current|today(?:'s)?)\s+(?:daily\s+)?loss\s*(?:is|=|:|of)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const maxPositions = query.match(/(?:maximum|max)\s+open\s+positions?\s*(?:is|=|:|of)?\s*(\d+)/i);
  const currentPositions = query.match(/(?:current|existing)\s+open\s+positions?\s*(?:is|=|:|of)?\s*(\d+)/i);
  const maxConsecutiveLosses = query.match(/(?:maximum|max)\s+consecutive\s+losses\s*(?:is|=|:|of)?\s*(\d+)/i);
  const currentConsecutiveLosses = query.match(/(?:current|existing)\s+consecutive\s+losses\s*(?:is|=|:|of)?\s*(\d+)/i);
  const stockAllocation = query.match(/(?:maximum|max)\s+(?:stock|per.stock)\s+(?:allocation|exposure)\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const totalExposure = query.match(/(?:maximum|max)\s+total\s+(?:allocation|exposure)\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const currentTotalExposure = query.match(/(?:current|existing)\s+total\s+(?:allocation|exposure)\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const sectorExposure = query.match(/(?:maximum|max)\s+sector\s+(?:allocation|exposure)\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const currentSectorExposure = query.match(/(?:current|existing)\s+sector\s+(?:allocation|exposure)\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const cooldownActive = /\b(?:cooldown is active|cooldown active|i am in (?:a )?cooldown|trading cooldown)\b/i.test(query);
  const ownsStock = /\b(i (?:own|hold|bought|purchased)|my (?:holding|position|shares)|should i hold|should i exit|book (?:partial |complete )?profit)\b/i.test(query);
  return {
    ownsStock,
    purchasePrice,
    quantity: positiveInteger(quantityMatch?.[1]),
    availableCapital: capital,
    acceptableRiskPct: boundedPercent(riskMatch?.[1]),
    horizon: extractHorizon(lower),
    accountEquity,
    maxDailyLoss: dailyLoss,
    currentDailyLoss,
    maxOpenPositions: positiveInteger(maxPositions?.[1]),
    currentOpenPositions: nonNegativeInteger(currentPositions?.[1]),
    maxConsecutiveLosses: positiveInteger(maxConsecutiveLosses?.[1]),
    currentConsecutiveLosses: nonNegativeInteger(currentConsecutiveLosses?.[1]),
    cooldownActive: cooldownActive || undefined,
    maxStockAllocationPct: boundedPercent(stockAllocation?.[1]),
    maxTotalExposurePct: boundedPercent(totalExposure?.[1]),
    currentTotalExposurePct: boundedPercent(currentTotalExposure?.[1], true),
    maxSectorExposurePct: boundedPercent(sectorExposure?.[1]),
    currentSectorExposurePct: boundedPercent(currentSectorExposure?.[1], true),
  };
}

export function extractHorizon(query: string): InvestmentHorizon | undefined {
  if (/\b(intraday|day trad|today|5.?min|15.?min|30.?min)\b/.test(query)) return 'intraday';
  if (/\b(swing|few days|one week|two weeks|1h|hourly)\b/.test(query)) return 'swing';
  if (/\b(long.?term|three years|five years|ten years|[3-9]\s*years?)\b/.test(query)) return 'long-term';
  if (/\b(positional|few months|six months|6 months|one year|1 year)\b/.test(query)) return 'positional';
  return undefined;
}

function extractAmount(query: string, pattern: RegExp): number | undefined {
  const match = query.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function boundedPercent(value?: string, allowZero = false) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) && parsed <= 100 ? parsed : undefined;
}

function positiveInteger(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInteger(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
