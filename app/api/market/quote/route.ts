import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveMarketData } from '@/lib/yahoo-finance/client';

/**
 * GET /api/market/quote?ticker=RELIANCE&exchange=NSE
 *
 * Returns live market data for an NSE/BSE-listed company.
 * Uses yahoo-finance2 with smart ticker resolution (search fallback for mismatched tickers).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');
  const exchange = (searchParams.get('exchange') ?? 'NSE') as 'NSE' | 'BSE';

  if (!ticker) {
    return NextResponse.json({ error: 'ticker query param is required' }, { status: 400 });
  }

  try {
    const data = await fetchLiveMarketData(ticker, exchange);

    if (!data) {
      return NextResponse.json(
        {
          error: `Could not resolve live data for "${ticker}" on ${exchange}. Tried direct lookup and Yahoo Finance search — ticker may be delisted or not yet indexed.`,
          ticker,
          exchange,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        // Cache for 5 minutes (Yahoo data can be 15-20 min delayed anyway)
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error('[/api/market/quote] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch market data', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
