import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { hybridSearchChunks } from '@/lib/documents/store';

export async function POST(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = await request.json();
    if (!body.query?.trim()) {
      return NextResponse.json({ error: 'Query required.' }, { status: 400 });
    }
    const chunks = await hybridSearchChunks(identity, {
      query: body.query,
      documentIds: Array.isArray(body.documentIds) ? body.documentIds : undefined,
      companyId: typeof body.companyId === 'string' ? body.companyId : undefined,
      topK: Math.min(Number(body.topK) || 8, 20),
    });
    return NextResponse.json({ chunks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed.';
    return NextResponse.json(
      { error: msg },
      { status: /identity/i.test(msg) ? 401 : 500 },
    );
  }
}
