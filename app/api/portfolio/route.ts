import { NextRequest, NextResponse } from 'next/server';
import { optimizePortfolio } from '@/lib/portfolio/optimization';
import type { PortfolioOptimizationInput } from '@/types/portfolio';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body: PortfolioOptimizationInput = await request.json();

    if (!Array.isArray(body.positions) || body.positions.length === 0) {
      return NextResponse.json({ error: 'At least one portfolio position is required.' }, { status: 400 });
    }

    if (!body.availableCapital || body.availableCapital <= 0) {
      return NextResponse.json({ error: 'Available capital must be a positive number.' }, { status: 400 });
    }

    if (!body.accountEquity || body.accountEquity <= 0) {
      return NextResponse.json({ error: 'Account equity must be a positive number.' }, { status: 400 });
    }

    const result = optimizePortfolio(body);
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Portfolio optimization failed.';
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
