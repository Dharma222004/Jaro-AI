import { NextRequest, NextResponse } from 'next/server';
import { checkUpstoxConnection } from '@/lib/upstox/health';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() || 'GAIL';
  const runEndpointTests = request.nextUrl.searchParams.get('test') !== '0';
  if (query.length > 100) return NextResponse.json({ error: 'Invalid instrument query.' }, { status: 400 });

  try {
    const status = await checkUpstoxConnection(query, runEndpointTests);
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Upstox diagnostics could not be completed.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
