import { NextRequest, NextResponse } from 'next/server';
import { removeFromWatchlist } from '@/lib/database/operations';
import { requireRequestAuth } from '@/lib/security/auth';
import { safePublicError } from '@/lib/security/redactor';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = requireRequestAuth(req);
    const { id } = await params;
    if (!id || id.length > 100) {
      return NextResponse.json({ error: 'Valid watchlist item ID is required.' }, { status: 400 });
    }
    const deleted = await removeFromWatchlist(auth.ownerKey, id);
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Watchlist entry not found for your account.' }, { status: 404 });
    }
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to remove from watchlist.';
    const status = /identity|session|token/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: safePublicError(err, 'Failed to remove from watchlist.') }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
