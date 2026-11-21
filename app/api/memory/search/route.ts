import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { searchMemoryAndJournal } from '@/lib/memory/search';
import type { MemoryType } from '@/types/memory';

const VALID_TYPES = new Set<MemoryType>([
  'working',
  'episodic',
  'semantic',
  'procedural',
  'profile',
  'project',
]);

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const query = request.nextUrl.searchParams.get('q') ?? '';
    const typesParam = request.nextUrl.searchParams.get('types');
    const types = typesParam
      ? typesParam
          .split(',')
          .filter((t): t is MemoryType => VALID_TYPES.has(t as MemoryType))
      : undefined;
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? '10'), 1), 50);
    const includeJournal = request.nextUrl.searchParams.get('includeJournal') === '1';

    if (!query.trim()) {
      return NextResponse.json({ error: 'A search query is required.' }, { status: 400 });
    }

    const results = await searchMemoryAndJournal({
      identity,
      query,
      types,
      limit,
      includeJournal,
    });

    return NextResponse.json({ results, count: results.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Memory search failed.';
    const status = /identity/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
