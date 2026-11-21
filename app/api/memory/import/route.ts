import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { importMemoryData } from '@/lib/memory/storage-adapter';
import type { MemorySystemExport } from '@/lib/memory/storage-adapter';

export async function POST(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = (await request.json()) as MemorySystemExport;

    if (!body || !body.data || typeof body.counts !== 'object') {
      return NextResponse.json({ error: 'Invalid memory export package structure.' }, { status: 400 });
    }

    const result = await importMemoryData(identity, body);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed.';
    return NextResponse.json({ error: message }, { status: /identity/i.test(message) ? 401 : 500 });
  }
}
