import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveMarketData } from '@/lib/yahoo-finance/client';
import { brokerAggregator } from '@/lib/broker/aggregator';

/**
 * GET /api/market/quote?ticker=ITC&exchange=NSE
 *
 * Returns authentic multi-broker market data for an NSE/BSE-listed company.
 * Priority: Broker Aggregator (Upstox -> Angel One -> m.Stock) with fundamental fallback.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');
  const exchange = (searchParams.get('exchange') ?? 'NSE') as 'NSE' | 'BSE';

  if (!ticker) {
    return NextResponse.json({ error: 'ticker query param is required' }, { status: 400 });
  }

  try {
    const [brokerQuote, fundamentalData] = await Promise.all([
      brokerAggregator.getUnifiedQuote(ticker, exchange).catch(() => null),
      fetchLiveMarketData(ticker, exchange).catch(() => null),
    ]);

    if (!brokerQuote && !fundamentalData) {
      return NextResponse.json(
        {
          error: `Could not resolve market data for "${ticker}" on ${exchange}.`,
          ticker,
          exchange,
        },
        { status: 404 }
      );
    }

    // Merge authentic broker quote with fundamental ratios
    const data = {
      ...(fundamentalData || {}),
      price: brokerQuote?.lastPrice ?? fundamentalData?.price ?? null,
      priceChange: brokerQuote?.change ?? fundamentalData?.priceChange ?? null,
      priceChangePct: brokerQuote?.changePercent ?? fundamentalData?.priceChangePct ?? null,
      open: brokerQuote?.open ?? fundamentalData?.open ?? null,
      dayHigh: brokerQuote?.high ?? fundamentalData?.dayHigh ?? null,
      dayLow: brokerQuote?.low ?? fundamentalData?.dayLow ?? null,
      volume: brokerQuote?.volume ?? fundamentalData?.volume ?? null,
      high52w: brokerQuote?.yearHigh ?? fundamentalData?.high52w ?? null,
      low52w: brokerQuote?.yearLow ?? fundamentalData?.low52w ?? null,
      fetchedAt: brokerQuote?.timestamp ?? fundamentalData?.fetchedAt ?? new Date().toISOString(),
      dataSource: brokerQuote ? 'live_exchange' : 'fundamental_database',
    };

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
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
