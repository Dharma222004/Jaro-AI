import { NextRequest, NextResponse } from 'next/server';
import { memoryIdentityFromRequest, memoryOwnerKey } from '@/lib/memory/identity';
import { exportMemoryData, createLocalBackup } from '@/lib/memory/storage-adapter';
import { recordSecurityAudit } from '@/lib/security/audit-logger';

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const ownerKey = memoryOwnerKey(identity);
    const saveLocal = request.nextUrl.searchParams.get('saveLocal') === 'true';

    if (saveLocal) {
      const backupResult = await createLocalBackup(identity);
      await recordSecurityAudit({
        ownerKey,
        eventType: 'export',
        action: 'memory_local_backup',
        status: 'success',
        metadata: { recordCounts: backupResult.recordCounts },
      });
      return NextResponse.json({
        success: true,
        backupPath: backupResult.backupPath,
        recordCounts: backupResult.recordCounts,
      });
    }

    const data = await exportMemoryData(identity);
    await recordSecurityAudit({
      ownerKey,
      eventType: 'export',
      action: 'memory_json_export',
      status: 'success',
      metadata: { counts: data.counts },
    });
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
