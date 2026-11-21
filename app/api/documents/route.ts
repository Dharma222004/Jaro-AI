import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { listDocuments, deleteDocument } from '@/lib/documents/store';
import { ingestDocument } from '@/lib/documents/ingestion-service';

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
  try {
    const identity = memoryIdentityFromRequest(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 50MB).' }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_TYPES.has(ext)) {
      return NextResponse.json({ error: `File type ${ext} not supported.` }, { status: 400 });
    }

    // Save upload
    if (!existsSync(/*turbopackIgnore: true*/ UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadPath = path.join(UPLOAD_DIR, `${Date.now()}_${safeName}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(uploadPath, buffer);

    // Ingest
    const result = await ingestDocument(identity, {
      filePath: uploadPath,
      fileName: file.name,
      fileType: ext.slice(1),
      fileSize: file.size,
      title: (formData.get('title') as string) || file.name,
      companyId: (formData.get('companyId') as string) || undefined,
      documentCategory: (formData.get('category') as string) || 'general',
      reportingPeriod: (formData.get('reportingPeriod') as string) || undefined,
    });

    return NextResponse.json(
      { result },
      { status: result.status === 'failed' ? 500 : 201 },
    );
  } catch (error) {
    return errResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Document ID required.' }, { status: 400 });
    const deleted = await deleteDocument(identity, id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errResponse(error);
  }
}

function errResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Operation failed.';
  return NextResponse.json(
    { error: message },
    { status: /identity/i.test(message) ? 401 : 500 },
  );
}
