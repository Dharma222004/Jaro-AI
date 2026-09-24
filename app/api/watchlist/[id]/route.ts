import { NextRequest, NextResponse } from 'next/server';
import { removeFromWatchlist } from '@/lib/database/operations';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await removeFromWatchlist(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/watchlist/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to remove from watchlist.' }, { status: 500 });
  }
}
