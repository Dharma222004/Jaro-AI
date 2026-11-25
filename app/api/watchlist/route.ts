import { NextRequest, NextResponse } from 'next/server';
import {
  getWatchlist,
  addToWatchlist,
  upsertCompany,
} from '@/lib/database/operations';
import { requireRequestAuth, enforceRouteRateLimit } from '@/lib/security/auth';
import { safePublicError } from '@/lib/security/redactor';
import type { CompanyIdentity } from '@/types/company';

export async function GET(request: NextRequest) {
  try {
    const auth = requireRequestAuth(request);
    const limit = enforceRouteRateLimit({ request, bucket: 'market_api', auth });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
    }
    const watchlist = await getWatchlist(auth.ownerKey);
    return NextResponse.json({ watchlist }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch watchlist.';
    const status = /identity|session|token/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: safePublicError(err, 'Failed to fetch watchlist.') }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireRequestAuth(req);
    const limit = enforceRouteRateLimit({ request: req, bucket: 'market_api', auth });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
    }
    const body = await req.json();
    const company: CompanyIdentity = body.company;

    if (!company?.name || !company?.ticker) {
      return NextResponse.json({ error: 'Company information is required.' }, { status: 400 });
    }

    const dbCompany = await upsertCompany({
      name: String(company.name).slice(0, 120),
      ticker: String(company.ticker).toUpperCase().slice(0, 30),
      exchange: company.exchange === 'BSE' ? 'BSE' : 'NSE',
      sector: company.sector ? String(company.sector).slice(0, 120) : undefined,
      industry: company.industry ? String(company.industry).slice(0, 120) : undefined,
      country: company.country ? String(company.country).slice(0, 60) : 'India',
    });

    await addToWatchlist(auth.ownerKey, dbCompany.id);

    return NextResponse.json({ success: true, companyId: dbCompany.id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add to watchlist.';
    const status = /identity|session|token/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: safePublicError(err, 'Failed to add to watchlist.') }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
