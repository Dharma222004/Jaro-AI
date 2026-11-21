import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { exportMemoryData, createLocalBackup } from '@/lib/memory/storage-adapter';

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const saveLocal = request.nextUrl.searchParams.get('saveLocal') === 'true';

    if (saveLocal) {
      const backupResult = await createLocalBackup(identity);
      return NextResponse.json({
        success: true,
        backupPath: backupResult.backupPath,
        recordCounts: backupResult.recordCounts,
      });
    }

    const data = await exportMemoryData(identity);
    return NextResponse.json(data, {
      headers: {
        'Content-Disposition': `attachment; filename="jaro_memory_export_${Date.now()}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed.';
    return NextResponse.json({ error: message }, { status: /identity/i.test(message) ? 401 : 500 });
  }
}
