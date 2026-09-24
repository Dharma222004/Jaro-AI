import { NextRequest, NextResponse } from 'next/server';
import { resolveCompanyFromQuery, runResearchPipeline } from '@/lib/research/orchestrator';
import type { CompanyIdentity } from '@/types/company';

export const maxDuration = 120; // 2 minutes for comprehensive research

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, company: preResolvedCompany, forceRefresh, stream } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Research query is required.' },
        { status: 400 }
      );
    }

    const trimmedQuery = query.trim();

    // Streaming mode via Server-Sent Events
    if (stream === true) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          const send = (data: Record<string, unknown>) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {
              // Ignore enqueue errors if connection closed
            }
          };

          try {
            send({
              type: 'stage',
              stage: 'company_id',
              status: 'running',
              label: 'Resolving company identity...',
            });

            let company: CompanyIdentity | null = preResolvedCompany ?? null;

            if (!company) {
              const resolution = await resolveCompanyFromQuery(trimmedQuery);
              if (!resolution.resolved) {
                if (resolution.candidates && resolution.candidates.length > 0) {
                  send({
                    type: 'ambiguous',
                    candidates: resolution.candidates,
                    query: trimmedQuery,
                  });
                } else {
                  send({
                    type: 'unresolved',
                    error: resolution.error || "We couldn't confidently identify this company. Try entering the NSE ticker or full company name.",
                  });
                }
                controller.close();
                return;
              }
              company = resolution.company;
            }

            send({
              type: 'stage',
              stage: 'company_id',
              status: 'completed',
              label: `Company identified: ${company.name} (${company.exchange}: ${company.ticker})`,
              detail: company.sector ? `${company.sector} · ${company.industry}` : undefined,
            });

            const stageLabels: Record<string, string> = {
              web_research: 'Multi-source research (Screener, BSE/NSE, Presentations, Press)',
              metric_extraction: 'Financial metric extraction & ratio calculation',
              validation: 'Cross-source validation & conflict detection',
              ai_analysis: 'Jaro AI is Analyzing & Synthesizing Financials',
              report_validation: 'Report finalization and schema verification',
            };

            const result = await runResearchPipeline({
              query: trimmedQuery,
              company,
              forceRefresh: !!forceRefresh,
              onStage: (stage, status, detail) => {
                send({
                  type: 'stage',
                  stage,
                  status,
                  label: stageLabels[stage] || stage,
                  detail,
                });
              },
            });

            if (result.status === 'failed') {
              send({
                type: 'error',
                error: result.error || 'Research could not be completed.',
              });
            } else {
              send({
                type: 'complete',
                data: {
                  status: 'completed',
                  researchId: result.researchId,
                  company: result.company,
                  report: result.report,
                  sources: result.sources,
                  processingMs: result.processingMs,
                  fromCache: result.fromCache,
                },
              });
            }
          } catch (err) {
            send({
              type: 'error',
              error: err instanceof Error ? err.message : 'Research pipeline encountered an unexpected error.',
            });
          } finally {
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        },
      });

      return new Response(customReadable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming JSON mode (standard POST)
    let company: CompanyIdentity | null = preResolvedCompany ?? null;

    if (!company) {
      const resolution = await resolveCompanyFromQuery(trimmedQuery);

      if (!resolution.resolved) {
        if (resolution.candidates && resolution.candidates.length > 0) {
          return NextResponse.json({
            status: 'ambiguous',
            candidates: resolution.candidates,
            query: trimmedQuery,
          });
        }
        return NextResponse.json(
          {
            status: 'unresolved',
            error: resolution.error || "We couldn't confidently identify this company. Try using the NSE ticker or full company name.",
          },
          { status: 404 }
        );
      }

      company = resolution.company;
    }

    const result = await runResearchPipeline({
      query: trimmedQuery,
      company,
      forceRefresh: !!forceRefresh,
    });

    if (result.status === 'failed') {
      return NextResponse.json(
        {
          status: 'failed',
          researchId: result.researchId,
          error: result.error ?? 'Research could not be completed.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: 'completed',
      researchId: result.researchId,
      company: result.company,
      report: result.report,
      sources: result.sources,
      processingMs: result.processingMs,
      fromCache: result.fromCache,
    });
  } catch (err) {
    console.error('[api/research] Unhandled error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
