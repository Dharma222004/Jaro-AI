import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRouteRateLimit, resolveRequestAuth } from '@/lib/security/auth';
import { safePublicError } from '@/lib/security/redactor';
import { deleteSavedScreener, listSavedScreeners, saveScreenerSpec } from '@/lib/screener/repository';
import type { ScreenerSpec } from '@/types/screener';

const SaveSchema = z.object({
  name: z.string().min(1).max(120),
  spec: z.unknown(),
  lastMatchCount: z.number().int().nonnegative().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = resolveRequestAuth(req);
    if (!auth.ownerKey) {
      return NextResponse.json({ saved: [] });
    }
    const saved = await listSavedScreeners(auth.ownerKey);
    return NextResponse.json({ saved });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err, 'Unable to list saved screeners.') }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = resolveRequestAuth(req);
    if (!auth.ownerKey) {
      return NextResponse.json({ error: 'Authentication required to save screener.' }, { status: 401 });
    }
    const limit = enforceRouteRateLimit({ request: req, bucket: 'portfolio_api', auth });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
    }
    const raw = await req.json();
    const parsed = SaveSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.spec || typeof parsed.data.spec !== 'object') {
      return NextResponse.json({ error: 'Valid screener name and specification are required.' }, { status: 400 });
    }
    const saved = await saveScreenerSpec({
      ownerKey: auth.ownerKey,
      name: parsed.data.name,
      spec: parsed.data.spec as ScreenerSpec,
      lastMatchCount: parsed.data.lastMatchCount ?? null,
    });
    return NextResponse.json({ saved }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err, 'Unable to save screener.') }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = resolveRequestAuth(req);
    if (!auth.ownerKey) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Screener id is required.' }, { status: 400 });
    }
    const ok = await deleteSavedScreener(auth.ownerKey, id);
    return NextResponse.json({ deleted: ok });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err, 'Unable to delete saved screener.') }, { status: 500 });
  }
}
