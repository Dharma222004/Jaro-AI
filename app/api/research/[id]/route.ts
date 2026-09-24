import { NextRequest, NextResponse } from 'next/server';
import { getResearchReport } from '@/lib/database/operations';
import type { ResearchSourceMeta } from '@/types/research';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await getResearchReport(id);

    if (!record) {
      return NextResponse.json({ error: 'Research report not found.' }, { status: 404 });
    }

    let report = null;
    if (record.reportJson) {
      try {
        report = JSON.parse(record.reportJson);
      } catch {
        // Report JSON corrupted
      }
    }

    const sources: ResearchSourceMeta[] = record.sources.map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      domain: s.domain,
      sourceType: (s.sourceType ?? 'other') as ResearchSourceMeta['sourceType'],
      authority: (s.authority ?? 'low') as ResearchSourceMeta['authority'],
      relevance: s.relevance ?? undefined,
      publishedAt: s.publishedAt?.toISOString(),
      retrievedAt: s.retrievedAt.toISOString(),
      snippet: s.snippet ?? undefined,
    }));

    return NextResponse.json({
      researchId: record.id,
      status: record.status,
      company: {
        name: record.company.name,
        ticker: record.company.ticker,
        exchange: record.company.exchange,
        country: record.company.country,
        sector: record.company.sector,
        industry: record.company.industry,
      },
      report,
      sources,
      error: record.errorMsg,
      processingMs: record.processingMs,
      createdAt: record.createdAt.toISOString(),
    });
  } catch (err) {
    console.error('[api/research/:id]', err);
    return NextResponse.json({ error: 'Failed to fetch research report.' }, { status: 500 });
  }
}
