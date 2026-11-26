// lib/screener/nl-parser.ts
// Deterministic Natural-Language-to-Filter parser and validator for Indian NSE/BSE equity screening.

import type { ConversationContext } from '@/types/conversation';
import type {
  ScreenerCondition,
  ScreenerExchangeFilter,
  ScreenerField,
  ScreenerLogicalOperator,
  ScreenerSortField,
  ScreenerSpec,
  ScreenerValidationResult,
  VolumeMode,
} from '@/types/screener';

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50,
  seventyfive: 75, hundred: 100,
};

/**
 * Converts Indian/standard numerical expressions into raw units.
 * Examples:
 * - "20 lakhs" -> 2,000,000
 * - "100000 crore" -> 100,000 (when target unit is Cr) or 1e12 (when target unit is INR)
 * - "one lakh crore" -> 100,000 Cr (= 1e12 INR)
 */
export function parseIndianNumber(rawNum: string, rawUnit = '', target: 'shares' | 'crores' | 'inr' = 'shares'): number | null {
  const cleaned = rawNum.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  const base = WORD_NUMBERS[cleaned] ?? Number(cleaned);
  if (!Number.isFinite(base)) return null;

  const u = rawUnit.trim().toLowerCase();
  let multiplier = 1;
  if (/lakh\s*crore|lac\s*crore|l\s*cr/.test(u)) {
    multiplier = 1e12;
  } else if (/crore|cr\b/.test(u)) {
    multiplier = 1e7;
  } else if (/lakh|lac|^l$/.test(u)) {
    multiplier = 1e5;
  } else if (/billion|bn/.test(u)) {
    multiplier = 1e9;
  } else if (/million|mn/.test(u)) {
    multiplier = 1e6;
  } else if (/thousand|^k$/.test(u)) {
    multiplier = 1e3;
  }

  const inrOrRaw = base * multiplier;
  if (target === 'crores') {
    return multiplier === 1 ? base : inrOrRaw / 1e7;
  }
  return inrOrRaw;
}

function maField(type: 'sma' | 'ema', period: number): ScreenerField | null {
  if (type === 'sma') {
    if ([5, 10, 20, 50, 100, 200].includes(period)) return `sma_${period}` as ScreenerField;
  } else {
    if ([9, 20, 50, 100, 200].includes(period)) return `ema_${period}` as ScreenerField;
  }
  return null;
}

function parseExchanges(query: string): ScreenerExchangeFilter {
  const hasNse = /\bnse\b/i.test(query);
  const hasBse = /\bbse\b/i.test(query);
  if (hasNse && !hasBse) return 'NSE';
  if (hasBse && !hasNse) return 'BSE';
  return 'BOTH';
}

function parseSector(query: string): string | null {
  const sectorMap: Array<[RegExp, string]> = [
    [/\b(?:bank|banking|banks)\b/i, 'Banking'],
    [/\b(?:it|information\s*technology|software|tech)\b/i, 'Information Technology'],
    [/\b(?:pharma|pharmaceuticals?|healthcare|hospital)\b/i, 'Healthcare'],
    [/\b(?:auto|automobile|automobiles|ev)\b/i, 'Automobile'],
    [/\b(?:fmcg|consumer\s*staples|consumer\s*goods)\b/i, 'FMCG'],
    [/\b(?:energy|oil|gas|power|utilities|renewable)\b/i, 'Energy'],
    [/\b(?:metal|metals|steel|mining|aluminium)\b/i, 'Metals'],
    [/\b(?:capital\s*goods|defence|defense|infrastructure|engineering)\b/i, 'Industrials'],
    [/\b(?:telecom|telecommunications)\b/i, 'Telecommunications'],
    [/\b(?:realty|real\s*estate)\b/i, 'Real Estate'],
    [/\b(?:chemical|chemicals|fertilizer)\b/i, 'Chemicals'],
    [/\b(?:nbfc|financial\s*services|insurance)\b/i, 'Financial Services'],
  ];
  for (const [re, name] of sectorMap) {
    if (re.test(query)) return name;
  }
  return null;
}

function parseVolumeMode(query: string): VolumeMode {
  const q = query.toLowerCase();
  if (/\b(?:intraday|current\s*(?:session|day)?\s*(?:cumulative\s*)?volume|live\s*volume|today'?s?\s*volume)\b/.test(q)) {
    return 'intraday_cumulative';
  }
  if (/\b(?:5[- ]?day\s*(?:avg|average)\s*(?:daily\s*)?volume|5d\s*avg\s*vol)\b/.test(q)) return 'avg_5d';
  if (/\b(?:20[- ]?day\s*(?:avg|average)\s*(?:daily\s*)?volume|20d\s*avg\s*vol|average\s*(?:daily\s*)?volume)\b/.test(q)) return 'avg_20d';
  if (/\b(?:50[- ]?day\s*(?:avg|average)\s*(?:daily\s*)?volume|50d\s*avg\s*vol)\b/.test(q)) return 'avg_50d';
  if (/\b(?:relative\s*volume|rvol|volume\s*ratio|volume\s*above\s*average|increasing\s*volume|volume\s*(?:expansion|breakout))\b/.test(q)) {
    return 'relative_volume';
  }
  return 'latest_completed_session';
}

function extractComparisonValue(
  clause: string,
  target: 'shares' | 'crores' | 'number' | 'pct',
): { operator: '>' | '>=' | '<' | '<=' | 'between'; value: number; valueTo?: number } | null {
  // Range: between X and Y
  const betweenMatch = clause.match(
    /\bbetween\s+(?:rs\.?|inr|₹)?\s*([\d,.]+|one|two|five|ten|twenty|fifty|hundred)\s*(lakh\s*crores?|l\s*cr|crores?|cr|lakhs?|lacs?|l|billion|bn|million|mn|k|%|percent)?\s+(?:and|to|-)\s+(?:rs\.?|inr|₹)?\s*([\d,.]+|one|two|five|ten|twenty|fifty|hundred)\s*(lakh\s*crores?|l\s*cr|crores?|cr|lakhs?|lacs?|l|billion|bn|million|mn|k|%|percent)?/i,
  );
  if (betweenMatch) {
    const unit2 = betweenMatch[4] ?? '';
    const unit1 = betweenMatch[2] || unit2;
    const convTarget = target === 'crores' ? 'crores' : target === 'shares' ? 'shares' : 'shares';
    const v1 = target === 'number' || target === 'pct'
      ? Number(betweenMatch[1].replace(/,/g, ''))
      : parseIndianNumber(betweenMatch[1], unit1, convTarget);
    const v2 = target === 'number' || target === 'pct'
      ? Number(betweenMatch[3].replace(/,/g, ''))
      : parseIndianNumber(betweenMatch[3], unit2, convTarget);
    if (v1 != null && v2 != null && Number.isFinite(v1) && Number.isFinite(v2)) {
      return { operator: 'between', value: Math.min(v1, v2), valueTo: Math.max(v1, v2) };
    }
  }

  const opRe = /(?:>=|<=|>|<|at\s*least|minimum|min|above|over|more\s+than|greater\s+than|exceeding|higher\s+than|at\s*most|maximum|max|below|under|less\s+than|lower\s+than)/i;
  const numUnitRe = /(?:rs\.?|inr|₹)?\s*([\d,.]+|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|fifty|hundred)\s*(lakh\s*crores?|l\s*cr|crores?|cr|lakhs?|lacs?|l\b|billion|bn|million|mn|thousand|k\b|%|percent|x\b)?/i;

  const fullMatch = clause.match(new RegExp(`(${opRe.source})\\s*(?:of|is|than)?\\s*${numUnitRe.source}`, 'i'));
  if (!fullMatch) return null;

  const opRaw = fullMatch[1].toLowerCase().trim();
  let operator: '>' | '>=' | '<' | '<=' = '>';
  if (opRaw === '>=' || /at\s*least|minimum|min/.test(opRaw)) operator = '>=';
  else if (opRaw === '<=' || /at\s*most|maximum|max/.test(opRaw)) operator = '<=';
  else if (opRaw === '<' || /below|under|less|lower/.test(opRaw)) operator = '<';

  const rawNum = fullMatch[2];
  const rawUnit = fullMatch[3] ?? '';

  let val: number | null = null;
  if (target === 'number' || target === 'pct') {
    const clean = rawNum.toLowerCase().replace(/,/g, '');
    val = WORD_NUMBERS[clean] ?? Number(clean);
  } else {
    val = parseIndianNumber(rawNum, rawUnit, target);
  }
  if (val == null || !Number.isFinite(val)) return null;

  return { operator, value: val };
}

function extractClause(query: string, keywordRe: RegExp): string | null {
  const m = keywordRe.exec(query);
  if (!m) return null;
  const tail = query.slice(m.index);
  // Stop at sentence/clause boundary, but NEVER break on decimals (1.5) or Indian/Western thousands commas (10,000)
  const stopMatch = tail.match(/(?<!\d)\.(?!\d)|[;\n]|,(?!\d{2,3}\b)/);
  return stopMatch && stopMatch.index != null ? tail.slice(0, stopMatch.index) : tail;
}

function addCondition(conditions: ScreenerCondition[], cond: Omit<ScreenerCondition, 'id'>) {
  const id = `cond_${conditions.length + 1}_${cond.field}`;
  const duplicate = conditions.some(
    (c) => c.field === cond.field && c.operator === cond.operator && c.value === cond.value && c.referenceField === cond.referenceField,
  );
  if (!duplicate) {
    conditions.push({ id, ...cond });
  }
}

export function parseNaturalLanguageScreen(query: string, context?: ConversationContext): ScreenerSpec {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const conditions: ScreenerCondition[] = [];
  const timeframe: '1d' | '1w' = /\bweekly|1w\b/i.test(qLower) ? '1w' : '1d';

  // Logical operator: OR only when explicitly used as top-level condition connector
  const hasExplicitOr = /\b(?:sma|ema|rsi|roce|roe|volume|market\s*cap|pe|debt|growth|cash\s*flow)\b[^.;]*\bor\b[^.;]*\b(?:sma|ema|rsi|roce|roe|volume|market\s*cap|pe|debt|growth|cash\s*flow)\b/i.test(q);
  const logicalOperator: ScreenerLogicalOperator = hasExplicitOr ? 'OR' : 'AND';

  // 1. Moving Average Crossovers & Comparisons (SMA/EMA)
  // 1a. "50 SMA above 200 SMA" / "50-day SMA above 200-day SMA" / "golden cross"
  const maVsMaMatch = q.match(
    /\b(5|9|10|20|50|100|200)[ -]?(?:day|d)?\s*(sma|ema|moving\s*average|dma)\s+(?:is\s+)?(above|greater\s+than|>|below|less\s+than|<)\s+(?:the\s+)?(5|9|10|20|50|100|200)[ -]?(?:day|d)?\s*(sma|ema|moving\s*average|dma)\b/i,
  );
  if (maVsMaMatch) {
    const p1 = Number(maVsMaMatch[1]);
    const t1 = /ema/i.test(maVsMaMatch[2]) ? 'ema' : 'sma';
    const op = /below|less|</i.test(maVsMaMatch[3]) ? '<' : '>';
    const p2 = Number(maVsMaMatch[4]);
    const t2 = /ema/i.test(maVsMaMatch[5]) ? 'ema' : 'sma';
    const f1 = maField(t1, p1);
    const f2 = maField(t2, p2);
    if (f1 && f2) {
      addCondition(conditions, {
        field: f1,
        operator: op,
        referenceField: f2,
        period: p1,
        timeframe,
        label: `${t1.toUpperCase()} ${p1} ${op} ${t2.toUpperCase()} ${p2}`,
      });
    }
  } else if (/\bgolden\s*cross\b/i.test(qLower)) {
    addCondition(conditions, {
      field: 'sma_50',
      operator: '>',
      referenceField: 'sma_200',
      period: 50,
      timeframe,
      label: 'SMA 50 > SMA 200 (Golden Cross)',
    });
  } else if (/\bdeath\s*cross\b/i.test(qLower)) {
    addCondition(conditions, {
      field: 'sma_50',
      operator: '<',
      referenceField: 'sma_200',
      period: 50,
      timeframe,
      label: 'SMA 50 < SMA 200 (Death Cross)',
    });
  }

  // 1b. "Price crossing above SMA 50"
  const crossMatch = q.match(/\b(?:price|close|stocks?|companies)?\s*crossing\s+(above|below)\s+(?:their\s+|its\s+|the\s+)?(?:(\d+)[ -]?(?:day|d)?\s*(sma|ema|moving\s*average|dma)|(sma|ema)\s*(\d+))\b/i);
  if (crossMatch) {
    const op = /below/i.test(crossMatch[1]) ? 'crosses_below' : 'crosses_above';
    const period = Number(crossMatch[2] || crossMatch[5] || 50);
    const type = /ema/i.test(crossMatch[3] || crossMatch[4] || '') ? 'ema' : 'sma';
    const targetField = maField(type, period);
    if (targetField) {
      addCondition(conditions, {
        field: 'daily_close',
        operator: op,
        referenceField: targetField,
        period,
        timeframe,
        label: `Close ${op === 'crosses_above' ? 'crossing above' : 'crossing below'} ${type.toUpperCase()} ${period}`,
      });
    }
  }

  // 1c. Percentage above/below SMA 50 (e.g. "at least 5% above SMA 50")
  const pctAboveSma = q.match(/([\d.]+)\s*%\s*(above|below)\s+(?:their\s+|the\s+)?(?:(\d+)[ -]?(?:day|d)?\s*)?(?:sma|moving\s*average|dma)/i);
  if (pctAboveSma) {
    const pctVal = Number(pctAboveSma[1]);
    const isBelow = /below/i.test(pctAboveSma[2]);
    if (Number.isFinite(pctVal)) {
      addCondition(conditions, {
        field: 'diff_from_sma_50_pct',
        operator: isBelow ? '<' : '>',
        value: isBelow ? -pctVal : pctVal,
        unit: '%',
        timeframe,
        label: `Price ${pctVal}% ${isBelow ? 'below' : 'above'} SMA 50`,
      });
    }
  }

  // 1d. Standard Price/Close vs MA ("above 50-day moving average", "50 days above moving average", "price above EMA 20 and EMA 50")
  if (!maVsMaMatch && !crossMatch) {
    // Handle multi-MA mention like "above EMA 20 and EMA 50" or "above SMA 50 and SMA 200"
    const dirMatch = q.match(/\b(above|below|over|under)\s+(?:their\s+|its\s+|the\s+)?([^.;,!?\n]+)/i);
    const maMentions = [...q.matchAll(/\b(?:(5|9|10|20|50|100|200)[ -]?(?:day|days|d)?\s*(?:above\s+)?(sma|ema|moving\s*average|dma)|(sma|ema)[ -]?(5|9|10|20|50|100|200))\b/gi)];
    if (maMentions.length > 0 && !pctAboveSma) {
      for (const m of maMentions) {
        const period = Number(m[1] || m[4] || 50);
        const typeRaw = m[2] || m[3] || 'sma';
        const type = /ema/i.test(typeRaw) ? 'ema' : 'sma';
        const targetField = maField(type, period);
        if (!targetField) continue;

        // Check local direction near the mention
        const idx = m.index ?? 0;
        const localWindow = q.slice(Math.max(0, idx - 35), Math.min(q.length, idx + m[0].length + 25)).toLowerCase();
        const isBelow = /\b(below|under|less\s+than|<)\b/.test(localWindow)
          || (dirMatch && /below|under/.test(dirMatch[1].toLowerCase()) && dirMatch[2].toLowerCase().includes(typeRaw.toLowerCase()));
        addCondition(conditions, {
          field: 'daily_close',
          operator: isBelow ? '<' : '>',
          referenceField: targetField,
          period,
          timeframe,
          label: `Close ${isBelow ? '<' : '>'} ${type.toUpperCase()} ${period}`,
        });
      }
    }
  }

  // 2. Daily Volume & Turnover (strictly separate shares vs INR turnover vs average vs relative)
  const volumeMode = parseVolumeMode(q);
  const turnoverClause = extractClause(q, /(?:daily\s+|traded\s+)?(?:turnover|traded\s*value|value\s*traded)/i);
  if (turnoverClause) {
    const parsed = extractComparisonValue(turnoverClause, 'crores');
    if (parsed) {
      addCondition(conditions, {
        field: 'daily_turnover_cr',
        operator: parsed.operator,
        value: parsed.value,
        valueTo: parsed.valueTo,
        unit: 'Cr',
        timeframe: '1d',
        label: `Daily Turnover ${parsed.operator} ₹${parsed.value.toLocaleString('en-IN')} Cr`,
      });
    }
  }

  const rvolClause = extractClause(q, /(?:relative\s*volume|rvol)/i);
  if (rvolClause) {
    const parsed = extractComparisonValue(rvolClause, 'number');
    if (parsed) {
      addCondition(conditions, {
        field: 'relative_volume',
        operator: parsed.operator,
        value: parsed.value,
        unit: 'x',
        timeframe: '1d',
        label: `Relative Volume ${parsed.operator} ${parsed.value}x`,
      });
    }
  } else if (/\b(?:volume\s+above\s+average|increasing\s+volume|volume\s*(?:expansion|breakout))\b/i.test(qLower)) {
    addCondition(conditions, {
      field: 'relative_volume',
      operator: '>',
      value: 1.5,
      unit: 'x',
      timeframe: '1d',
      label: 'Volume > 1.5x 20D Avg',
    });
  }

  const volClause = extractClause(q, /(?:daily\s+(?:trading\s+)?volume|(?:5|20|50)[- ]?(?:day|d)\s+(?:avg|average)\s+(?:daily\s+)?volume|average\s+daily\s+volume|intraday\s+(?:cumulative\s+)?volume|trading\s+volume|volume)/i);
  if (volClause && !/turnover|traded\s*value/i.test(volClause) && !rvolClause) {
    const parsed = extractComparisonValue(volClause, 'shares');
    if (parsed) {
      const volField: ScreenerField =
        volumeMode === 'intraday_cumulative' ? 'intraday_volume'
          : volumeMode === 'avg_5d' ? 'avg_volume_5d'
            : volumeMode === 'avg_20d' ? 'avg_volume_20d'
              : volumeMode === 'avg_50d' ? 'avg_volume_50d'
                : 'daily_volume';
      const labelPrefix =
        volumeMode === 'intraday_cumulative' ? 'Intraday Volume'
          : volumeMode === 'avg_5d' ? '5D Avg Volume'
            : volumeMode === 'avg_20d' ? '20D Avg Volume'
              : volumeMode === 'avg_50d' ? '50D Avg Volume'
                : 'Daily Volume';
      addCondition(conditions, {
        field: volField,
        operator: parsed.operator,
        value: parsed.value,
        valueTo: parsed.valueTo,
        unit: 'shares',
        timeframe: '1d',
        label: `${labelPrefix} ${parsed.operator} ${parsed.value >= 1e5 ? `${(parsed.value / 1e5).toFixed(parsed.value % 1e5 === 0 ? 0 : 1)} Lakh shares` : `${parsed.value.toLocaleString('en-IN')} shares`}`,
      });
    }
  }

  // 3. Market Capitalization
  const mcapClause = extractClause(q, /(?:market\s*cap(?:itali[sz]ation)?|mcap)/i);
  if (mcapClause) {
    const parsed = extractComparisonValue(mcapClause, 'crores');
    if (parsed) {
      const formatCr = (v: number) => (v >= 100000 && v % 100000 === 0 ? `₹${v / 100000} Lakh Cr` : `₹${v.toLocaleString('en-IN')} Cr`);
      addCondition(conditions, {
        field: 'market_cap_cr',
        operator: parsed.operator,
        value: parsed.value,
        valueTo: parsed.valueTo,
        unit: 'Cr',
        timeframe: '1d',
        label: parsed.operator === 'between' && parsed.valueTo != null
          ? `Market Cap ${formatCr(parsed.value)} – ${formatCr(parsed.valueTo)}`
          : `Market Cap ${parsed.operator} ${formatCr(parsed.value)}`,
      });
    }
  } else {
    if (/\blarge[- ]?cap\b/i.test(qLower)) {
      addCondition(conditions, { field: 'market_cap_cr', operator: '>=', value: 20_000, unit: 'Cr', timeframe: '1d', label: 'Market Cap >= ₹20,000 Cr (Large Cap)' });
    } else if (/\bmid[- ]?cap\b/i.test(qLower)) {
      addCondition(conditions, { field: 'market_cap_cr', operator: 'between', value: 5_000, valueTo: 20_000, unit: 'Cr', timeframe: '1d', label: 'Market Cap ₹5,000 – ₹20,000 Cr (Mid Cap)' });
    } else if (/\bsmall[- ]?cap\b/i.test(qLower)) {
      addCondition(conditions, { field: 'market_cap_cr', operator: '<', value: 5_000, unit: 'Cr', timeframe: '1d', label: 'Market Cap < ₹5,000 Cr (Small Cap)' });
    }
  }

  // 4. RSI & Momentum
  const rsiClause = extractClause(q, /\brsi(?:\s*\(\s*14\s*\))?/i);
  if (rsiClause) {
    const parsed = extractComparisonValue(rsiClause, 'number');
    if (parsed) {
      addCondition(conditions, {
        field: 'rsi_14',
        operator: parsed.operator,
        value: parsed.value,
        valueTo: parsed.valueTo,
        period: 14,
        timeframe,
        label: `RSI(14) ${parsed.operator} ${parsed.value}`,
      });
    }
  } else if (/\boversold\b/i.test(qLower)) {
    addCondition(conditions, { field: 'rsi_14', operator: '<', value: 30, period: 14, timeframe, label: 'RSI(14) < 30 (Oversold)' });
  } else if (/\boverbought\b/i.test(qLower)) {
    addCondition(conditions, { field: 'rsi_14', operator: '>', value: 70, period: 14, timeframe, label: 'RSI(14) > 70 (Overbought)' });
  }

  if (/\bmacd\s+(?:bullish\s+)?cross(?:over)?\b/i.test(qLower)) {
    addCondition(conditions, { field: 'macd_bullish_crossover', operator: '=', value: 1, timeframe, label: 'MACD Bullish Crossover' });
  } else if (/\bmacd\s+(?:above|>)\s*signal\b/i.test(qLower)) {
    addCondition(conditions, { field: 'macd_above_signal', operator: '=', value: 1, timeframe, label: 'MACD > Signal' });
  }

  // 5. 52-Week High / Low & Price Structure
  if (/\bbreakout\s+(?:above\s+)?52[- ]?week\s*high\b/i.test(qLower)) {
    addCondition(conditions, { field: 'breakout_52w_high', operator: '=', value: 1, timeframe: '1d', label: '52-Week High Breakout' });
  } else if (/\bnear\s+(?:their\s+|its\s+)?52[- ]?week\s*highs?\b/i.test(qLower)) {
    addCondition(conditions, { field: 'distance_from_52w_high_pct', operator: '<=', value: 5, unit: '%', timeframe: '1d', label: 'Within 5% of 52W High' });
  }
  if (/\bnear\s+(?:their\s+|its\s+)?52[- ]?week\s*lows?\b/i.test(qLower)) {
    addCondition(conditions, { field: 'distance_from_52w_low_pct', operator: '<=', value: 10, unit: '%', timeframe: '1d', label: 'Within 10% of 52W Low' });
  }
  if (/\bhigher\s+highs?\s+and\s+higher\s+lows?\b/i.test(qLower)) {
    addCondition(conditions, { field: 'higher_highs_lows', operator: '=', value: 1, timeframe, label: 'Higher Highs & Higher Lows' });
  }

  // 6. Fundamental Conditions
  const roceClause = extractClause(q, /\broce/i);
  if (roceClause) {
    const parsed = extractComparisonValue(roceClause, 'pct');
    if (parsed) {
      addCondition(conditions, { field: 'roce_pct', operator: parsed.operator, value: parsed.value, valueTo: parsed.valueTo, unit: '%', timeframe: '1d', label: `ROCE ${parsed.operator} ${parsed.value}%` });
    } else if (/\bhigh\s+roce\b/i.test(qLower)) {
      addCondition(conditions, { field: 'roce_pct', operator: '>=', value: 18, unit: '%', timeframe: '1d', label: 'ROCE >= 18%' });
    }
  } else if (/\bhigh\s+roce\b/i.test(qLower)) {
    addCondition(conditions, { field: 'roce_pct', operator: '>=', value: 18, unit: '%', timeframe: '1d', label: 'ROCE >= 18%' });
  }

  const roeClause = extractClause(q, /\broe/i);
  if (roeClause) {
    const parsed = extractComparisonValue(roeClause, 'pct');
    if (parsed) {
      addCondition(conditions, { field: 'roe_pct', operator: parsed.operator, value: parsed.value, valueTo: parsed.valueTo, unit: '%', timeframe: '1d', label: `ROE ${parsed.operator} ${parsed.value}%` });
    } else if (/\bhigh\s+roe\b/i.test(qLower)) {
      addCondition(conditions, { field: 'roe_pct', operator: '>=', value: 15, unit: '%', timeframe: '1d', label: 'ROE >= 15%' });
    }
  } else if (/\bhigh\s+roe\b/i.test(qLower)) {
    addCondition(conditions, { field: 'roe_pct', operator: '>=', value: 15, unit: '%', timeframe: '1d', label: 'ROE >= 15%' });
  }

  const deClause = extractClause(q, /(?:debt\s*(?:to|\/)\s*equity|d\/e)/i);
  if (deClause) {
    const parsed = extractComparisonValue(deClause, 'number');
    if (parsed) {
      addCondition(conditions, { field: 'debt_to_equity', operator: parsed.operator, value: parsed.value, timeframe: '1d', label: `Debt/Equity ${parsed.operator} ${parsed.value}` });
    }
  } else if (/\b(?:low\s+debt|debt[- ]?free|minimal\s+debt)\b/i.test(qLower)) {
    addCondition(conditions, { field: 'debt_to_equity', operator: '<=', value: 0.5, timeframe: '1d', label: 'Debt/Equity <= 0.5 (Low Debt)' });
  }

  const revClause = extractClause(q, /(?:revenue|sales)\s*growth/i);
  if (revClause) {
    const parsed = extractComparisonValue(revClause, 'pct');
    if (parsed) {
      addCondition(conditions, { field: 'revenue_growth_pct', operator: parsed.operator, value: parsed.value, unit: '%', timeframe: '1d', label: `Revenue Growth ${parsed.operator} ${parsed.value}%` });
    }
  } else if (/\b(?:consistent|strong|positive)\s+revenue\s+growth\b/i.test(qLower)) {
    addCondition(conditions, { field: 'revenue_growth_pct', operator: '>', value: 10, unit: '%', timeframe: '1d', label: 'Revenue Growth > 10%' });
  }

  const profitClause = extractClause(q, /(?:net\s*profit|earnings|pat)\s*growth/i);
  if (profitClause) {
    const parsed = extractComparisonValue(profitClause, 'pct');
    if (parsed) {
      addCondition(conditions, { field: 'net_profit_growth_pct', operator: parsed.operator, value: parsed.value, unit: '%', timeframe: '1d', label: `Profit Growth ${parsed.operator} ${parsed.value}%` });
    }
  } else if (/\b(?:consistent|strong|positive)\s+(?:profit|earnings)\s+growth\b/i.test(qLower)) {
    addCondition(conditions, { field: 'net_profit_growth_pct', operator: '>', value: 10, unit: '%', timeframe: '1d', label: 'Profit Growth > 10%' });
  }

  if (/\bpositive\s+free\s+cash\s*flow\b|\bfcf\s*>\s*0\b/i.test(qLower)) {
    addCondition(conditions, { field: 'free_cash_flow_cr', operator: '>', value: 0, unit: 'Cr', timeframe: '1d', label: 'Free Cash Flow > ₹0 Cr' });
  }
  if (/\bpositive\s+operating\s+cash\s*flow\b|\bocf\s*>\s*0\b/i.test(qLower)) {
    addCondition(conditions, { field: 'operating_cash_flow_cr', operator: '>', value: 0, unit: 'Cr', timeframe: '1d', label: 'Operating Cash Flow > ₹0 Cr' });
  }

  const peClause = extractClause(q, /\b(?:p\/e|pe\s*ratio|pe)\b/i);
  if (peClause) {
    const parsed = extractComparisonValue(peClause, 'number');
    if (parsed) {
      addCondition(conditions, { field: 'pe', operator: parsed.operator, value: parsed.value, valueTo: parsed.valueTo, timeframe: '1d', label: `P/E ${parsed.operator} ${parsed.value}` });
    }
  }

  if (/\bfundamentally\s+strong\b/i.test(qLower)) {
    addCondition(conditions, { field: 'roe_pct', operator: '>=', value: 15, unit: '%', timeframe: '1d', label: 'ROE >= 15%' });
    addCondition(conditions, { field: 'debt_to_equity', operator: '<=', value: 0.75, timeframe: '1d', label: 'Debt/Equity <= 0.75' });
  }

  // 7. Sorting & Limit
  let sortBy: ScreenerSortField = 'market_cap_cr';
  let sortOrder: 'DESC' | 'ASC' = 'DESC';
  if (/\bsort(?:ed)?\s+by\s+(?:highest\s+)?roce\b/i.test(qLower)) {
    sortBy = 'roce_pct';
  } else if (/\bsort(?:ed)?\s+by\s+(?:highest\s+)?roe\b/i.test(qLower)) {
    sortBy = 'roe_pct';
  } else if (/\bsort(?:ed)?\s+by\s+(?:highest\s+)?volume\b/i.test(qLower)) {
    sortBy = 'daily_volume';
  } else if (/\bsort(?:ed)?\s+by\s+(?:lowest\s+)?pe\b/i.test(qLower)) {
    sortBy = 'pe';
    sortOrder = 'ASC';
  } else if (/\bsort(?:ed)?\s+by\s+(?:highest\s+)?(?:revenue\s*)?growth\b/i.test(qLower)) {
    sortBy = 'revenue_growth_pct';
  } else if (!mcapClause && conditions.some((c) => c.field === 'daily_volume')) {
    sortBy = 'daily_volume';
  }

  const limitMatch = q.match(/\b(?:top|first|limit)\s+(\d{1,3})\b/i);
  const limit = limitMatch ? Math.min(Math.max(Number(limitMatch[1]), 1), 200) : 50;

  return {
    intent: 'stock_screening',
    rawQuery: query,
    exchanges: parseExchanges(q),
    securityUniverse: 'active_listed_equity',
    includeSme: /\bsme\b/i.test(qLower),
    excludeNonEquity: true,
    sector: parseSector(q) ?? context?.activeSector ?? null,
    volumeMode,
    conditions,
    logicalOperator,
    sortBy,
    sortOrder,
    limit,
  };
}

/**
 * Merges a conversational follow-up modifier (e.g. "Show only the banking companies",
 * "Sort by highest ROCE", "Only NSE stocks", "Change volume to 50 lakhs") onto an existing ScreenerSpec.
 */
export function mergeScreenerFollowUp(prev: ScreenerSpec, followUpQuery: string): ScreenerSpec {
  const q = followUpQuery.trim();
  const qLower = q.toLowerCase();
  const next: ScreenerSpec = {
    ...prev,
    rawQuery: `${prev.rawQuery} · ${q}`,
    conditions: [...prev.conditions],
  };

  if (/\bonly\s+nse\b|\bnse\s+only\b/i.test(qLower)) next.exchanges = 'NSE';
  else if (/\bonly\s+bse\b|\bbse\s+only\b/i.test(qLower)) next.exchanges = 'BSE';
  else if (/\bboth\s+exchanges|nse\s+and\s+bse\b/i.test(qLower)) next.exchanges = 'BOTH';

  const nextSector = parseSector(q);
  if (nextSector) next.sector = nextSector;
  if (/\ball\s+sectors?|clear\s+sector\b/i.test(qLower)) next.sector = null;

  if (/\binclude\s+sme\b/i.test(qLower)) next.includeSme = true;
  if (/\bexclude\s+sme|mainboard\s+only\b/i.test(qLower)) next.includeSme = false;

  const parsedPatch = parseNaturalLanguageScreen(q);
  for (const cond of parsedPatch.conditions) {
    const idx = next.conditions.findIndex((c) => c.field === cond.field && c.referenceField === cond.referenceField);
    if (idx >= 0) next.conditions[idx] = cond;
    else next.conditions.push({ ...cond, id: `cond_${next.conditions.length + 1}_${cond.field}` });
  }

  // Handle "change volume to 50 lakhs" even without comparator word ">"
  const changeVolMatch = q.match(/\b(?:change|set|update)\s+(?:daily\s+)?volume\s+(?:to\s+)?([\d,.]+|one|two|five|ten|twenty|fifty)\s*(lakhs?|lacs?|l|crores?|cr|million|k)?/i);
  if (changeVolMatch) {
    const shares = parseIndianNumber(changeVolMatch[1], changeVolMatch[2] ?? '', 'shares');
    if (shares != null && shares > 0) {
      const idx = next.conditions.findIndex((c) => c.field === 'daily_volume' || c.field === 'avg_volume_20d');
      const updated = {
        id: idx >= 0 ? next.conditions[idx].id : `cond_${next.conditions.length + 1}_daily_volume`,
        field: 'daily_volume' as const,
        operator: '>' as const,
        value: shares,
        unit: 'shares',
        timeframe: '1d' as const,
        label: `Daily Volume > ${(shares / 1e5).toFixed(shares % 1e5 === 0 ? 0 : 1)} Lakh shares`,
      };
      if (idx >= 0) next.conditions[idx] = updated;
      else next.conditions.push(updated);
    }
  }

  if (/\bsort(?:ed)?\s+by|\brank\s+by|\border\s+by\b/i.test(qLower)) {
    next.sortBy = parsedPatch.sortBy;
    next.sortOrder = parsedPatch.sortOrder;
  }

  const limitMatch = q.match(/\b(?:top|first|limit)\s+(\d{1,3})\b/i);
  if (limitMatch) next.limit = Math.min(Math.max(Number(limitMatch[1]), 1), 200);

  return next;
}

export function validateScreenerSpec(spec: ScreenerSpec): ScreenerValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (spec.conditions.length === 0 && !spec.sector) {
    warnings.push('No explicit quantitative filter conditions detected; applying default liquid NSE/BSE equity screen.');
  }

  for (const cond of spec.conditions) {
    if (cond.operator === 'between') {
      if (cond.value == null || cond.valueTo == null || cond.value > cond.valueTo) {
        errors.push(`Invalid range condition for ${cond.label}`);
      }
    } else if (!cond.referenceField && cond.value == null) {
      errors.push(`Missing threshold or reference indicator for ${cond.label}`);
    }
    if (cond.field === 'daily_volume' && (cond.value ?? 0) < 0) {
      errors.push('Volume threshold cannot be negative.');
    }
    if (cond.field === 'market_cap_cr' && (cond.value ?? 0) < 0) {
      errors.push('Market capitalization threshold cannot be negative.');
    }
    if (cond.field === 'rsi_14' && cond.value != null && (cond.value < 0 || cond.value > 100)) {
      errors.push('RSI(14) threshold must be between 0 and 100.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function describeScreenerSpec(spec: ScreenerSpec): string[] {
  const labels = spec.conditions.map((c) => c.label);
  if (spec.sector) labels.push(`Sector: ${spec.sector}`);
  labels.push(`Universe: ${spec.exchanges === 'BOTH' ? 'NSE + BSE' : spec.exchanges}${spec.includeSme ? ' (incl. SME)' : ' Equity'}`);
  if (spec.logicalOperator === 'OR' && spec.conditions.length > 1) {
    labels.push('Match Logic: OR');
  }
  return labels;
}
