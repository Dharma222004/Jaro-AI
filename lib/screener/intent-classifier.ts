// lib/screener/intent-classifier.ts
// Separates multi-stock natural language screening queries from single-stock
// investment decisions, technical chart requests, company research, and general chat.

import type { ConversationContext } from '@/types/conversation';

const PLURAL_SCREENING_SUBJECT_RE = /\b(?:stocks?|companies|shares|equities|scrips|candidates|firms|tickers)\b/i;

const SCREENING_ACTION_RE = /\b(?:screen|screener|filter|scan|list(?:\s+me)?|find(?:\s+me)?|show(?:\s+me)?|give(?:\s+me)?|get(?:\s+me)?|identify|which|what\s+are\s+the|discover|search\s+for|shortlist|fetch)\b/i;

const MULTI_CONDITION_METRIC_RE = /\b(?:sma|ema|moving\s*average|dma|volume|turnover|market\s*cap(?:itali[sz]ation)?|mcap|roce|roe|roa|debt\s*(?:to|\/)\s*equity|low\s*debt|debt[- ]?free|rsi|macd|stochastic|atr|bollinger|52[- ]?week\s*(?:high|low)|free\s*cash\s*flow|fcf|operating\s*cash\s*flow|ocf|revenue\s*growth|profit\s*growth|earnings\s*growth|eps\s*growth|cagr|p\/e|pe\s*ratio|p\/b|pb\s*ratio|ev\s*\/\s*ebitda|peg|dividend\s*yield|promoter\s*(?:holding|pledge)|fii|dii|institutional\s*holding|relative\s*strength|breakout|oversold|overbought|golden\s*cross|death\s*cross|undervalued|fundamentally\s*strong|margin)\b/i;

const FOLLOWUP_SCREEN_MODIFIER_RE = /^\s*(?:show\s+only|only\s+(?:nse|bse|[a-z\s]+(?:stocks?|companies|sector))|filter\s+by|sort\s+by|rank\s+by|order\s+by|change\s+(?:volume|market\s*cap|sma|ema|rsi|roce|roe|limit|exchange|sort)|update\s+(?:volume|market\s*cap|sma|ema|rsi|roce|roe)|increase\s+(?:volume|market\s*cap)|decrease\s+(?:volume|market\s*cap)|reduce\s+(?:volume|market\s*cap)|add\s+(?:a\s+)?(?:filter|condition)|remove\s+(?:the\s+)?|exclude\s+|include\s+sme|top\s+\d+\s+only)\b/i;

const ORDINAL_COMPANY_DRILLDOWN_RE = /\b(?:explain|analyse|analyze|research|details?\s+(?:of|on|for)|fundamentals?\s+(?:of|for)|about)\s+(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|top)\s+(?:stock|company|one|match|result|candidate)\b/i;

/**
 * Extracts 0-based index when user drills down into a screened result, e.g.
 * "Explain the fundamentals of the first stock".
 */
export function extractScreenerOrdinalRef(query: string): number | null {
  const m = query.match(ORDINAL_COMPANY_DRILLDOWN_RE);
  if (!m) return null;
  const token = m[1].toLowerCase();
  if (token === 'first' || token === '1st' || token === 'top') return 0;
  if (token === 'second' || token === '2nd') return 1;
  if (token === 'third' || token === '3rd') return 2;
  if (token === 'fourth' || token === '4th') return 3;
  if (token === 'fifth' || token === '5th') return 4;
  return null;
}

/**
 * Determines whether a query is a multi-stock screening follow-up modifier
 * operating on an active conversation screening specification.
 */
export function isScreenerFollowUp(query: string, context?: ConversationContext): boolean {
  if (!context || (context.lastIntent !== 'stock_screening' && context.lastIntent !== 'stock_discovery' && !context.activeScreenerSpec)) {
    return false;
  }
  if (extractScreenerOrdinalRef(query) !== null) return false;
  const q = query.trim();
  if (FOLLOWUP_SCREEN_MODIFIER_RE.test(q)) return true;
  if (/^\s*(?:only|just)\s+(?:the\s+)?(?:nse|bse|banking|it|pharma|auto|fmcg|energy|metals|psu|healthcare|telecom|realty|infrastructure)\b/i.test(q)) {
    return true;
  }
  return false;
}

/**
 * Strictly separates multi-stock screening queries from single-stock analysis,
 * Breakout/Retest decisions, sector rankings, mutual funds, and comparisons.
 */
export function isStockScreeningQuery(query: string, context?: ConversationContext): boolean {
  const q = query.trim();
  if (!q) return false;

  // Drill-down on a specific screened result is company research, not screening
  if (extractScreenerOrdinalRef(q) !== null) return false;

  // Mutual fund / SIP queries are never equity stock screening
  if (/\b(?:mutual\s*funds?|index\s*funds?|flexi[- ]?cap\s*funds?|sip\b|amfi|expense\s*ratio|nav\b)\b/i.test(q)) {
    return false;
  }

  // Direct comparison of named stocks is stock_comparison, not screening
  if (/\b(?:compare|versus|vs\.?)\b/i.test(q) && !PLURAL_SCREENING_SUBJECT_RE.test(q)) {
    return false;
  }

  // Follow-up filter/sort/exchange modification on an active screen
  if (isScreenerFollowUp(q, context)) {
    return true;
  }

  // Explicit screener keyword
  if (/\b(?:stock\s*screener|run\s+(?:a\s+)?screen|screen\s+(?:for\s+)?(?:stocks?|companies|equities)|screener\s+for)\b/i.test(q)) {
    return true;
  }

  const hasPluralSubject = PLURAL_SCREENING_SUBJECT_RE.test(q);
  const hasAction = SCREENING_ACTION_RE.test(q);
  const hasMetric = MULTI_CONDITION_METRIC_RE.test(q);

  // Plural stocks/companies + metric condition (e.g. "List me the stocks that are having 50 days above moving average...")
  if (hasPluralSubject && hasMetric) {
    return true;
  }

  // Plural stocks/companies + action verb + numeric/relational condition
  if (
    hasPluralSubject &&
    hasAction &&
    /\b(?:above|below|over|under|more\s+than|greater\s+than|less\s+than|between|with|having|where|near|crossing|positive|high|low|consistent|increasing|strong)\b/i.test(q)
  ) {
    return true;
  }

  // Multi-condition metric filter even without explicit "stocks" word (e.g. "NSE above SMA 50 and volume > 20 lakh")
  if (
    /\b(?:above|below|>|<|more\s+than|greater\s+than|less\s+than)\b/i.test(q) &&
    (q.match(/\b(?:sma\s*\d+|ema\s*\d+|moving\s*average|volume|turnover|market\s*cap|roce|roe|rsi|debt\s*to\s*equity|free\s*cash\s*flow)\b/gi)?.length ?? 0) >= 2
  ) {
    return true;
  }

  return false;
}
