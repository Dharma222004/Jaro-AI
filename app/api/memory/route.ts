import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { createOrUpdateMemory, deleteAllMemories, deleteMemory, listMemories, updateMemory } from '@/lib/memory/store';
import type { MemoryType } from '@/types/memory';

const MEMORY_TYPES = new Set<MemoryType>(['working', 'episodic', 'semantic', 'procedural', 'profile', 'project']);

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const rawType = request.nextUrl.searchParams.get('type');
    const type = rawType && MEMORY_TYPES.has(rawType as MemoryType) ? rawType as MemoryType : undefined;
    const memories = await listMemories(identity, type);
    return NextResponse.json({ memories }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = await request.json();
    if (!MEMORY_TYPES.has(body.type as MemoryType)) return NextResponse.json({ error: 'Invalid memory type.' }, { status: 400 });
    if (typeof body.summary !== 'string' || !body.summary.trim()) return NextResponse.json({ error: 'Memory summary is required.' }, { status: 400 });
    const memory = await createOrUpdateMemory(identity, {
      type: body.type,
      eventType: typeof body.eventType === 'string' ? body.eventType : 'user_saved',
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : undefined,
      summary: body.summary,
      content: body.content && typeof body.content === 'object' ? body.content : { explicitlySaved: true },
      entities: Array.isArray(body.entities) ? body.entities.filter((item: unknown): item is string => typeof item === 'string') : [],
      confidence: 1,
      importance: typeof body.importance === 'number' ? body.importance : 0.9,
    });
    return NextResponse.json({ memory }, { status: 201 });
  } catch (error) {
    return responseError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = await request.json();
    if (typeof body.id !== 'string') return NextResponse.json({ error: 'Memory ID is required.' }, { status: 400 });
    const memory = await updateMemory(identity, body.id, {
      summary: typeof body.summary === 'string' ? body.summary : undefined,
      importance: typeof body.importance === 'number' ? body.importance : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
    });
    if (!memory) return NextResponse.json({ error: 'Memory was not found.' }, { status: 404 });
    return NextResponse.json({ memory });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    if (id) {
      const result = await deleteMemory(identity, id);
      return NextResponse.json({ deleted: result.count });
    }
    if (request.nextUrl.searchParams.get('all') === '1') {
      const result = await deleteAllMemories(identity);
      return NextResponse.json({ deleted: result.count });
    }
    return NextResponse.json({ error: 'Memory ID or all=1 is required.' }, { status: 400 });
  } catch (error) {
    return responseError(error);
  }
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Memory operation failed.';
  const status = /identity/i.test(message) ? 401 : 500;
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
