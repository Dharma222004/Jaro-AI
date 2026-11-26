import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRouteRateLimit, resolveRequestAuth } from '@/lib/security/auth';
import { sanitizeUserMessage } from '@/lib/security/input-guard';
import { safePublicError } from '@/lib/security/redactor';
import { runStockScreener } from '@/lib/screener/service';
import { buildScreenerCsv } from '@/lib/screener/export-service';
import { getScreenerRun, listSavedScreeners, persistScreenerRun } from '@/lib/screener/repository';
import type { ScreenerSpec } from '@/types/screener';

export const maxDuration = 120;

const PostBodySchema = z.object({
  query: z.string().max(800).optional(),
  spec: z.unknown().optional(),
  format: z.enum(['json', 'csv']).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = resolveRequestAuth(req);
    const ownerKey = auth.ownerKey ?? 'anonymous';
    const jobId = req.nextUrl.searchParams.get('jobId');
    if (jobId) {
      const run = await getScreenerRun(ownerKey, jobId);
      if (!run) {
        return NextResponse.json({ error: 'Screener run not found.' }, { status: 404 });
      }
      return NextResponse.json({ result: run });
    }
    const saved = await listSavedScreeners(ownerKey);
    return NextResponse.json({ saved });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err, 'Unable to load screener data.') }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = resolveRequestAuth(req);
    const limit = enforceRouteRateLimit({ request: req, bucket: 'market_api', auth });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Screener rate limit exceeded. Please retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
      );
    }

    const raw = await req.json();
    const parsed = PostBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid screener request payload.' }, { status: 400 });
    }

    const queryText = parsed.data.query?.trim() || 'Custom equity screen';
    const check = sanitizeUserMessage(queryText, 800);
    if (!check.valid) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const result = await runStockScreener({
      query: check.text,
      specOverride: parsed.data.spec as ScreenerSpec | undefined,
      signal: req.signal,
    });

    await persistScreenerRun(auth.ownerKey ?? 'anonymous', result);

    if (parsed.data.format === 'csv') {
      const csv = buildScreenerCsv(result.rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="jaro-screener-${result.jobId}.csv"`,
        },
      });
    }

    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err, 'Stock screening could not be completed.') }, { status: 400 });
  }
}
