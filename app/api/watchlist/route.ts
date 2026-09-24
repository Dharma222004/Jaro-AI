import { NextRequest, NextResponse } from 'next/server';
import {
  getWatchlist,
  addToWatchlist,
  upsertCompany,
} from '@/lib/database/operations';
import type { CompanyIdentity } from '@/types/company';

export async function GET() {
  try {
    const watchlist = await getWatchlist();
    return NextResponse.json({ watchlist });
  } catch (err) {
    console.error('[api/watchlist GET]', err);
    return NextResponse.json({ error: 'Failed to fetch watchlist.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const company: CompanyIdentity = body.company;

    if (!company?.name || !company?.ticker) {
      return NextResponse.json({ error: 'Company information is required.' }, { status: 400 });
    }

    const dbCompany = await upsertCompany({
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange ?? 'NSE',
      sector: company.sector,
      industry: company.industry,
      country: company.country ?? 'India',
    });

    await addToWatchlist(dbCompany.id);

    return NextResponse.json({ success: true, companyId: dbCompany.id });
  } catch (err) {
    console.error('[api/watchlist POST]', err);
    return NextResponse.json({ error: 'Failed to add to watchlist.' }, { status: 500 });
  }
}
