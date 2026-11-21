import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { createEpisode, searchEpisodes, listEpisodes, deleteEpisode } from '@/lib/memory/episodic-store';

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const query = request.nextUrl.searchParams.get('q') ?? '';
    const eventType = request.nextUrl.searchParams.get('eventType') ?? undefined;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50');

    const episodes = query
      ? await searchEpisodes(identity, { query, limit })
      : await listEpisodes(identity, { eventType, limit });
    return NextResponse.json({ episodes }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = await request.json();
    if (!body.title?.trim() || !body.summary?.trim()) {
      return NextResponse.json({ error: 'Title and summary required.' }, { status: 400 });
    }
    const episode = await createEpisode(identity, {
      eventType: body.eventType ?? 'user_preference',
      title: body.title,
      summary: body.summary,
      entities: Array.isArray(body.entities) ? body.entities : [],
      documentIds: Array.isArray(body.documentIds) ? body.documentIds : [],
      outcome: body.outcome,
      importance: typeof body.importance === 'number' ? body.importance : 0.5,
      confidence: typeof body.confidence === 'number' ? body.confidence : 0.8,
      metadata: body.metadata ?? {},
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : undefined,
    });
    return NextResponse.json({ episode }, { status: 201 });
  } catch (error) {
    return errResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Episode ID required.' }, { status: 400 });
    const deleted = await deleteEpisode(identity, id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errResponse(error);
  }
}

function errResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Operation failed.';
  const status = /identity/i.test(message) ? 401 : 500;
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
