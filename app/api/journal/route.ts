import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { memoryIdentityFromRequest } from '@/lib/memory/identity';
import { createTradeJournalEntry, deleteJournalRecord, JournalInputError, listStrategySignals, listTradeJournal, refreshShadowSignal } from '@/lib/strategy/journal';

export const maxDuration = 60;

const optionalPositiveNumber = z.preprocess(
  (value) => value == null || value === '' ? undefined : value,
  z.coerce.number().finite().positive().optional(),
);
const optionalNonNegativeNumber = z.preprocess(
  (value) => value == null || value === '' ? undefined : value,
  z.coerce.number().finite().nonnegative().optional(),
);
const optionalDate = z.preprocess(
  (value) => value == null || value === '' ? undefined : value,
  z.coerce.date().optional(),
);
const tradeInputSchema = z.object({
  signalId: z.string().trim().min(1).max(100).optional(),
  instrumentKey: z.string().trim().min(3).max(200).optional(),
  ticker: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9&._-]+$/).optional(),
  strategyId: z.string().trim().max(100).optional(),
  strategyVersion: z.string().trim().max(100).optional(),
  actualEntry: z.coerce.number().finite().positive(),
  actualExit: optionalPositiveNumber,
  quantity: z.coerce.number().int().positive().max(100_000_000),
  actualCharges: optionalNonNegativeNumber,
  entryAt: z.coerce.date(),
  exitAt: optionalDate,
  notes: z.string().trim().max(2_000).optional(),
}).superRefine((value, context) => {
  if (!value.signalId && (!value.instrumentKey || !value.ticker)) {
    context.addIssue({ code: 'custom', message: 'Instrument key and ticker are required when no signal is linked.' });
  }
  if ((value.actualExit == null) !== (value.exitAt == null)) {
    context.addIssue({ code: 'custom', message: 'Actual exit price and exit timestamp must be supplied together.' });
  }
  if (value.exitAt && value.exitAt < value.entryAt) {
    context.addIssue({ code: 'custom', message: 'Exit timestamp cannot precede entry.' });
  }
});

export async function GET(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const [signals, trades] = await Promise.all([listStrategySignals(identity), listTradeJournal(identity)]);
    return NextResponse.json({ signals, trades }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const body = await request.json();
    if (typeof body.id !== 'string') return NextResponse.json({ error: 'Signal ID is required.' }, { status: 400 });
    const signal = await refreshShadowSignal(identity, body.id);
    if (!signal) return NextResponse.json({ error: 'Signal not found.' }, { status: 404 });
    return NextResponse.json({ signal });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const parsed = tradeInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid trade journal input.' }, { status: 400 });
    const trade = await createTradeJournalEntry(identity, parsed.data);
    return NextResponse.json({ trade }, { status: 201 });
  } catch (error) { return fail(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const identity = memoryIdentityFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');
    const kind = request.nextUrl.searchParams.get('kind');
    if (!id || (kind !== 'signal' && kind !== 'trade')) return NextResponse.json({ error: 'Valid kind and ID are required.' }, { status: 400 });
    const result = await deleteJournalRecord(identity, kind, id);
    return NextResponse.json({ deleted: result.count });
  } catch (error) { return fail(error); }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : 'Journal operation failed.';
  const status = error instanceof JournalInputError ? error.status : /identity/i.test(message) ? 401 : 500;
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
