import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { optimizePortfolio } from '@/lib/portfolio/optimization';
import { listPortfolioHoldings, upsertPortfolioHoldings, deletePortfolioHolding } from '@/lib/portfolio/store';
import { enforceRouteRateLimit, requireRequestAuth } from '@/lib/security/auth';
import { safePublicError } from '@/lib/security/redactor';
import type { PortfolioOptimizationInput } from '@/types/portfolio';

export const maxDuration = 60;

const holdingInputSchema = z.object({
  instrumentKey: z.string().trim().max(120).optional(),
  ticker: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9&._-]+$/),
  exchange: z.enum(['NSE', 'BSE']).default('NSE'),
  sector: z.string().trim().max(80).default('General'),
  side: z.enum(['long', 'short']).default('long'),
  quantity: z.coerce.number().finite().positive().max(100_000_000),
  entryPrice: z.coerce.number().finite().positive(),
  currentPrice: z.coerce.number().finite().positive().optional(),
  stopLoss: z.coerce.number().finite().positive().optional(),
  target: z.coerce.number().finite().positive().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = requireRequestAuth(request);
    const limit = enforceRouteRateLimit({ request, bucket: 'portfolio_api', auth });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
    }
    const holdings = await listPortfolioHoldings(auth.identity);
    return NextResponse.json({ holdings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to load portfolio.';
    const status = /identity|session|token/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: safePublicError(error, 'Failed to load portfolio.') }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireRequestAuth(request);
    const limit = enforceRouteRateLimit({ request, bucket: 'portfolio_api', auth });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
    }

    const body = (await request.json()) as PortfolioOptimizationInput & { persistHoldings?: boolean };

    if (!Array.isArray(body.positions) || body.positions.length === 0) {
      return NextResponse.json({ error: 'At least one portfolio position is required.' }, { status: 400 });
    }
    if (body.positions.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 positions supported per optimization.' }, { status: 400 });
    }

    if (!body.availableCapital || body.availableCapital <= 0) {
      return NextResponse.json({ error: 'Available capital must be a positive number.' }, { status: 400 });
    }

    if (!body.accountEquity || body.accountEquity <= 0) {
      return NextResponse.json({ error: 'Account equity must be a positive number.' }, { status: 400 });
    }

    if (body.persistHoldings === true) {
      const validated = body.positions
        .map((p) => holdingInputSchema.safeParse(p))
        .filter((r) => r.success)
        .map((r) => r.data);
      if (validated.length > 0) {
        await upsertPortfolioHoldings(auth.identity, validated);
      }
    }

    const result = optimizePortfolio(body);
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Portfolio optimization failed.';
    const status = /identity|session|token/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: safePublicError(error, 'Portfolio optimization failed.') }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = requireRequestAuth(request);
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Holding ID required.' }, { status: 400 });
    const deleted = await deletePortfolioHolding(auth.identity, id);
    return NextResponse.json({ deleted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to remove holding.';
    const status = /identity|session|token/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: safePublicError(error, 'Failed to remove holding.') }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
