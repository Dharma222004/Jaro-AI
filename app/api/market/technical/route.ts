import { NextRequest, NextResponse } from 'next/server';
import { parseTimeframe, runTechnicalAnalysis } from '@/lib/technical/engine';
import type { TechnicalTimeframe } from '@/types/technical';
import { getUpstoxConfiguration, UpstoxApiError, toPublicUpstoxError } from '@/lib/upstox/client';

export const maxDuration = 60;

const ALLOWED_TIMEFRAMES = new Set<TechnicalTimeframe>(['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1mo']);

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const requestedTimeframe = request.nextUrl.searchParams.get('timeframe') as TechnicalTimeframe | null;
  const exchangeParam = request.nextUrl.searchParams.get('exchange');
  const fromParam = request.nextUrl.searchParams.get('from');

  if (!query || query.length > 150) return NextResponse.json({ error: 'A valid instrument query is required.' }, { status: 400 });
  if (requestedTimeframe && !ALLOWED_TIMEFRAMES.has(requestedTimeframe)) return NextResponse.json({ error: 'Unsupported timeframe.' }, { status: 400 });
  const exchange = exchangeParam === 'BSE' ? 'BSE' : exchangeParam === 'NSE' ? 'NSE' : undefined;
  const from = fromParam ? new Date(fromParam) : undefined;
  if (from && Number.isNaN(from.getTime())) return NextResponse.json({ error: 'Invalid from date.' }, { status: 400 });

  try {
    const result = await runTechnicalAnalysis({
      query,
      timeframe: requestedTimeframe ?? parseTimeframe(query),
      exchange,
      from,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('[/api/market/technical]', error instanceof Error ? error.message : 'Unknown technical analysis error');
    const status = error instanceof UpstoxApiError ? error.status : 422;
    const safeError = toPublicUpstoxError(error);
    return NextResponse.json({
      error: safeError.message,
      category: safeError.category,
      code: safeError.code,
      retryable: safeError.retryable,
      tokenConfigured: getUpstoxConfiguration().tokenConfigured,
      provider: 'Upstox',
    }, { status });
  }
}
