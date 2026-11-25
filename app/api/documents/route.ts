import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { memoryIdentityFromRequest, memoryOwnerKey } from '@/lib/memory/identity';
import { listDocuments, deleteDocument } from '@/lib/documents/store';
import { ingestDocument } from '@/lib/documents/ingestion-service';
import { enforceRouteRateLimit, resolveRequestAuth } from '@/lib/security/auth';
import { ensurePathWithinDirectory, sanitizeStorageFilename } from '@/lib/security/input-guard';
import { recordSecurityAudit } from '@/lib/security/audit-logger';
import { safePublicError } from '@/lib/security/redactor';

const UPLOAD_DIR = process.env.DOCS_UPLOAD_DIR ?? path.join(process.cwd(), 'data', 'uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_TYPES = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls',
  '.csv', '.txt', '.md', '.html', '.htm', '.json',
]);

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const documents = await listDocuments(identity);
    return NextResponse.json({ documents }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let uploadPath: string | null = null;
  try {
    const identity = memoryIdentityFromRequest(request);
    const auth = resolveRequestAuth(request);
    const limit = enforceRouteRateLimit({ request, bucket: 'document_upload', auth });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Upload rate limit exceeded. Please wait before uploading again.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File must be between 1 byte and 50MB.' }, { status: 400 });
    }

    const safeName = sanitizeStorageFilename(file.name);
    const ext = path.extname(safeName).toLowerCase();
    if (!ALLOWED_TYPES.has(ext)) {
      return NextResponse.json({ error: `File type ${ext} not supported.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (ext === '.pdf' && !buffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      return NextResponse.json({ error: 'Invalid PDF file signature.' }, { status: 400 });
    }

    if (!existsSync(/*turbopackIgnore: true*/ UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    uploadPath = ensurePathWithinDirectory(UPLOAD_DIR, path.join(UPLOAD_DIR, `${Date.now()}_${safeName}`));
    writeFileSync(uploadPath, buffer);

    const result = await ingestDocument(identity, {
      filePath: uploadPath,
      fileName: safeName,
      fileType: ext.slice(1),
      fileSize: file.size,
      title: (formData.get('title') as string)?.slice(0, 200) || safeName,
      companyId: (formData.get('companyId') as string)?.slice(0, 100) || undefined,
      documentCategory: (formData.get('category') as string)?.slice(0, 60) || 'general',
      reportingPeriod: (formData.get('reportingPeriod') as string)?.slice(0, 60) || undefined,
    });

    await recordSecurityAudit({
      ownerKey: memoryOwnerKey(identity),
      eventType: 'memory_change',
      action: 'document_uploaded',
      resource: result.documentId || safeName,
      status: result.status === 'failed' ? 'error' : 'success',
      clientIp: auth.clientIp,
      metadata: { chunkCount: result.chunkCount, fileType: ext.slice(1) },
    });

    return NextResponse.json(
      { result },
      { status: result.status === 'failed' ? 500 : 201 },
    );
  } catch (error) {
    return errResponse(error);
  } finally {
    if (uploadPath && existsSync(/*turbopackIgnore: true*/ uploadPath)) {
      try { unlinkSync(uploadPath); } catch { /* best-effort temp cleanup */ }
    }
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Document ID required.' }, { status: 400 });
    const deleted = await deleteDocument(identity, id);
    await recordSecurityAudit({
      ownerKey: memoryOwnerKey(identity),
      eventType: 'memory_change',
      action: 'document_deleted',
      resource: id,
      status: deleted ? 'success' : 'denied',
    });
    return NextResponse.json({ deleted });
  } catch (error) {
    return errResponse(error);
  }
}

function errResponse(error: unknown) {
  const message = safePublicError(error, 'Document operation failed.');
  const rawMsg = error instanceof Error ? error.message : '';
  return NextResponse.json(
    { error: message },
    { status: /identity|session|token/i.test(rawMsg) ? 401 : 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
