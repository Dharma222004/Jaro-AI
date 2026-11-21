import { NextRequest, NextResponse } from 'next/server';
import { resolveUpstoxInstrument } from '@/lib/upstox/instruments';
import { defaultLookback, getHistoricalCandles } from '@/lib/upstox/candles';
import type { TechnicalTimeframe } from '@/types/technical';
import { getUpstoxConfiguration, UpstoxApiError, toPublicUpstoxError } from '@/lib/upstox/client';
import { backtestSystematicStrategy } from '@/lib/strategy/backtest';
import { recordBacktestHistory } from '@/lib/strategy/backtest-history';
import type { StrategyId } from '@/types/strategy';

export const maxDuration = 60;
const ALLOWED = new Set<TechnicalTimeframe>(['1d']);
const STRATEGIES = new Set<StrategyId>(['trend_pullback_continuation', 'breakout_retest']);

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const timeframe = (request.nextUrl.searchParams.get('timeframe') ?? '1d') as TechnicalTimeframe;
  const strategyParam = request.nextUrl.searchParams.get('strategy') ?? 'all';
  if (!query || query.length > 100) return NextResponse.json({ error: 'A valid instrument query is required.' }, { status: 400 });
  if (!ALLOWED.has(timeframe)) return NextResponse.json({ error: 'Systematic playbook backtesting currently supports completed daily candles.' }, { status: 400 });
  if (strategyParam !== 'all' && !STRATEGIES.has(strategyParam as StrategyId)) return NextResponse.json({ error: 'Unknown strategy identifier.' }, { status: 400 });
  try {
    const resolution = await resolveUpstoxInstrument(query);
    if (!resolution.instrument) return NextResponse.json({ error: 'Instrument could not be resolved unambiguously.' }, { status: 422 });
    const benchmarkResolution = await resolveUpstoxInstrument('NIFTY 50');
    if (!benchmarkResolution.instrument) return NextResponse.json({ error: 'NIFTY 50 benchmark could not be resolved for market-regime simulation.' }, { status: 503 });
    const from = defaultLookback(timeframe);
    if (timeframe === '1d') from.setUTCFullYear(from.getUTCFullYear() - 8);
    if (timeframe === '1w') from.setUTCFullYear(from.getUTCFullYear() - 10);
    const [candleResult, benchmarkResult] = await Promise.all([
      getHistoricalCandles({ instrument: resolution.instrument, timeframe, from }),
      getHistoricalCandles({ instrument: benchmarkResolution.instrument, timeframe, from }),
    ]);
    const strategyIds: StrategyId[] = strategyParam === 'all' ? [...STRATEGIES] : [strategyParam as StrategyId];
    const results = strategyIds.map((strategyId) => backtestSystematicStrategy({ instrument: resolution.instrument!, timeframe, candles: candleResult.candles, benchmark: benchmarkResolution.instrument!, benchmarkCandles: benchmarkResult.candles, strategyId }));
    const history = await recordBacktestHistory(results);
    return NextResponse.json({
      instrument: resolution.instrument,
      benchmark: benchmarkResolution.instrument,
      timeframe,
      data: {
        candles: candleResult.candles.length,
        validation: candleResult.validation,
        cacheHit: candleResult.cacheHit,
        staleCache: candleResult.staleCache,
        benchmarkCandles: benchmarkResult.candles.length,
        benchmarkValidation: benchmarkResult.validation,
      },
      history,
      results,
    });
  } catch (error) {
    const safeError = toPublicUpstoxError(error);
    return NextResponse.json({
      error: safeError.message,
      category: safeError.category,
      code: safeError.code,
      retryable: safeError.retryable,
      tokenConfigured: getUpstoxConfiguration().tokenConfigured,
    }, { status: error instanceof UpstoxApiError ? error.status : 500 });
  }
}
