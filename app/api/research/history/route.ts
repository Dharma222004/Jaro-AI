import { NextRequest, NextResponse } from 'next/server';
import { getResearchHistory } from '@/lib/database/operations';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);

    const reports = await getResearchHistory(Math.min(limit, 50));

    const history = reports.map((r) => ({
      id: r.id,
      companyName: r.company.name,
      ticker: r.company.ticker,
      exchange: r.company.exchange,
      query: r.query,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ history });
  } catch (err) {
    console.error('[api/research/history]', err);
    return NextResponse.json({ error: 'Failed to fetch research history.' }, { status: 500 });
  }
}
