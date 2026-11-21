import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import {
  upsertLongTermMemory,
  listLongTermMemories,
  retrieveLongTermMemories,
  deleteLongTermMemory,
} from '@/lib/memory/long-term-store';
import type { LTMCategory } from '@/lib/memory/long-term-store';

const VALID_CATEGORIES = new Set<LTMCategory>(['semantic', 'procedural', 'preference', 'project']);

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const rawCategory = request.nextUrl.searchParams.get('category');
    const category =
      rawCategory && VALID_CATEGORIES.has(rawCategory as LTMCategory)
        ? (rawCategory as LTMCategory)
        : undefined;
    const query = request.nextUrl.searchParams.get('q');
    const memories = query
      ? await retrieveLongTermMemories(identity, {
          query,
          categories: category ? [category] : undefined,
        })
      : await listLongTermMemories(identity, category);
    return NextResponse.json({ memories }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = await request.json();
    if (!VALID_CATEGORIES.has(body.category as LTMCategory)) {
      return NextResponse.json({ error: 'Invalid category.' }, { status: 400 });
    }
    if (!body.title?.trim() || !body.value?.trim()) {
      return NextResponse.json({ error: 'Title and value required.' }, { status: 400 });
    }
    const memory = await upsertLongTermMemory(identity, {
      category: body.category,
      memoryKey: body.memoryKey,
      title: body.title,
      value: body.value,
      summary: body.summary,
      sourceType: body.sourceType ?? 'user_explicit',
      confidence: body.confidence ?? 1.0,
      importance: body.importance ?? 0.9,
    });
    return NextResponse.json({ memory }, { status: 201 });
  } catch (error) {
    return errResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Memory ID required.' }, { status: 400 });
    const deleted = await deleteLongTermMemory(identity, id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errResponse(error);
  }
}

function errResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Operation failed.';
  return NextResponse.json(
    { error: message },
    { status: /identity/i.test(message) ? 401 : 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
