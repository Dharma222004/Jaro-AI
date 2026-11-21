import { createHash } from 'node:crypto';
import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from '@/lib/memory/identity';
import { getHistoricalCandles } from '@/lib/upstox/candles';
import type { InvestmentDecisionResult } from '@/types/decision';
import type { UpstoxInstrument } from '@/types/technical';
import type { StrategySignalRecord, StrategySignalSetup, StrategySignalSnapshot } from '@/types/journal';
import { STRATEGY_CONFIGS } from './config';

export class JournalInputError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message);
    this.name = 'JournalInputError';
  }
}

export async function recordStrategySignal(identity: string, result: InvestmentDecisionResult) {
  const strategy = result.systematic?.selected;
  if (!strategy) return null;
  const ownerKey = memoryOwnerKey(identity);
  const signalKey = createHash('sha256').update(`${ownerKey}:${result.company.exchange}:${result.company.ticker}:${strategy.strategyVersion}:${result.marketTimestamp}`).digest('hex');
  const shadowPendingGateIds = new Set(['confirmation', 'event-calendar']);
  const shadowBlockingGates = strategy.gates.filter((gate) => gate.mandatory && gate.status !== 'pass' && !shadowPendingGateIds.has(gate.id));
  const shadowTrackable = ['ENTRY_AVAILABLE', 'WAIT_FOR_CONFIRMATION'].includes(strategy.status)
    && shadowBlockingGates.length === 0
    && Boolean(strategy.entry && strategy.stop && strategy.targets.length);
  const setup = {
    status: strategy.status,
    releaseStatus: strategy.releaseStatus,
    rulesQualified: strategy.rulesQualified,
    shadowTrackable,
    eligible: strategy.eligible,
    entry: strategy.entry,
    stop: strategy.stop,
    targets: strategy.targets,
    costs: strategy.costs,
    gates: strategy.gates,
    audit: strategy.audit,
    expiry: strategy.entry?.expiry ?? null,
    maximumHoldingBars: STRATEGY_CONFIGS[strategy.strategyId].maximumHoldingBars,
  };
  const snapshot = {
    currentPrice: result.currentPrice,
    marketDataStatus: result.marketDataStatus,
    instrument: result.technical.primary.instrument,
    timeframe: result.technical.primary.timeframe,
    lastCandleAt: result.technical.primary.lastCandleAt,
    validation: result.technical.primary.validation,
    marketRegime: strategy.marketRegime,
    sectorStrength: strategy.sectorStrength,
    stockStrength: strategy.stockStrength,
  };
  const record = await prisma.strategySignal.upsert({
    where: { signalKey },
    create: {
      signalKey, ownerKey, instrumentKey: result.technical.primary.instrument.instrument_key,
      ticker: result.company.ticker, exchange: result.company.exchange,
      strategyId: strategy.strategyId, strategyVersion: strategy.strategyVersion,
      decisionStatus: strategy.status, mode: 'shadow', marketTimestamp: new Date(result.marketTimestamp),
      detectedAt: new Date(strategy.detectedAt), setupJson: JSON.stringify(setup), snapshotJson: JSON.stringify(snapshot),
      outcomeStatus: shadowTrackable ? 'pending' : 'rejected',
      outcomeJson: shadowTrackable ? null : JSON.stringify({
        reason: 'No hypothetical entry was tracked because the original research scenario was not executable under the shadow-monitoring policy.',
        decisionStatus: strategy.status,
        blockingGates: shadowBlockingGates.map((gate) => ({ id: gate.id, status: gate.status, reason: gate.reason })),
      }),
      closedAt: shadowTrackable ? null : new Date(strategy.detectedAt),
    },
    update: {},
  });
  return toSignal(record);
}

export async function listStrategySignals(identity: string, limit = 100) {
  const ownerKey = memoryOwnerKey(identity);
  const records = await prisma.strategySignal.findMany({ where: { ownerKey }, orderBy: { detectedAt: 'desc' }, take: Math.min(limit, 200) });
  return records.map(toSignal);
}

export async function refreshShadowSignal(identity: string, id: string) {
  const ownerKey = memoryOwnerKey(identity);
  const signal = await prisma.strategySignal.findFirst({ where: { id, ownerKey } });
  if (!signal) return null;
  if (signal.outcomeStatus !== 'pending' && signal.outcomeStatus !== 'triggered') return toSignal(signal);
  const setup = parseRecord<StrategySignalSetup>(signal.setupJson);
  const snapshot = parseRecord<StrategySignalSnapshot>(signal.snapshotJson);
  const instrument = snapshot.instrument as UpstoxInstrument | undefined;
  const entry = setup.entry as { zoneLow: number; zoneHigh: number; triggerPrice: number; maximumEntryPrice: number; expiry?: string } | null;
  const stop = setup.stop as { price: number } | null;
  const targets = Array.isArray(setup.targets) ? setup.targets as Array<{ price: number; label: string }> : [];
  if (!instrument || !entry || !stop || !targets.length) {
    return toSignal(await prisma.strategySignal.update({ where: { id }, data: { outcomeStatus: 'invalidated', outcomeJson: JSON.stringify({ reason: 'Original signal did not contain a complete executable scenario.' }), closedAt: new Date() } }));
  }
  const from = new Date(signal.marketTimestamp);
  from.setUTCDate(from.getUTCDate() - 2);
  const candleResult = await getHistoricalCandles({ instrument, timeframe: '1d', from });
  const candles = candleResult.candles.filter((candle) => new Date(candle.timestamp) > signal.marketTimestamp);
  const expiry = entry.expiry?.match(/(20\d{2}-\d{2}-\d{2})/)?.[1];
  const costs = setup.costs;
  const maximumHoldingBars = Number.isInteger(setup.maximumHoldingBars) && setup.maximumHoldingBars > 0
    ? setup.maximumHoldingBars
    : 25;
  let enteredAt: string | null = null;
  let entryPrice: number | null = null;
  let referenceEntry: number | null = null;
  let entryCandleIndex: number | null = null;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!enteredAt) {
      if (candle.close >= entry.triggerPrice && candle.close <= entry.maximumEntryPrice) {
        const next = candles[index + 1];
        if (!next) break;
        referenceEntry = next.open;
        entryPrice = applyBuySlippage(referenceEntry, costs?.slippageBpsPerSide ?? 0);
        if (entryPrice > entry.maximumEntryPrice) {
          return closeShadow(signal.id, 'invalidated', {
            reason: `The next-open hypothetical fill ${roundMoney(entryPrice)} exceeded the original maximum entry ${roundMoney(entry.maximumEntryPrice)}. No fill was assumed.`,
            triggerAt: candle.timestamp,
            source: 'Upstox daily candles',
            validation: candleResult.validation,
          });
        }
        enteredAt = next.timestamp;
        entryCandleIndex = index + 1;
        index += 1;
        const immediateExit = shadowExitForCandle(next, stop.price, targets, entryPrice);
        if (immediateExit) return closeShadow(signal.id, immediateExit.status, buildShadowOutcome({ enteredAt, entryPrice, referenceEntry, candle: next, rawExit: immediateExit.rawExit, target: immediateExit.target, stopPrice: stop.price, costs, holdingBars: 1, validation: candleResult.validation }));
        if (maximumHoldingBars === 1) return closeShadow(signal.id, 'time_exit', buildShadowOutcome({ enteredAt, entryPrice, referenceEntry, candle: next, rawExit: next.close, target: null, stopPrice: stop.price, costs, holdingBars: 1, validation: candleResult.validation, reason: 'Maximum holding period reached.' }));
      }
      continue;
    }
    const holdingBars = entryCandleIndex == null ? 1 : index - entryCandleIndex + 1;
    const exit = shadowExitForCandle(candle, stop.price, targets, entryPrice!);
    if (exit) return closeShadow(signal.id, exit.status, buildShadowOutcome({ enteredAt, entryPrice: entryPrice!, referenceEntry: referenceEntry!, candle, rawExit: exit.rawExit, target: exit.target, stopPrice: stop.price, costs, holdingBars, validation: candleResult.validation }));
    if (holdingBars >= maximumHoldingBars) return closeShadow(signal.id, 'time_exit', buildShadowOutcome({ enteredAt, entryPrice: entryPrice!, referenceEntry: referenceEntry!, candle, rawExit: candle.close, target: null, stopPrice: stop.price, costs, holdingBars, validation: candleResult.validation, reason: 'Maximum holding period reached.' }));
  }
  if (!enteredAt && expiry && new Date() > new Date(`${expiry}T23:59:59+05:30`)) return closeShadow(signal.id, 'expired', { reason: 'Entry trigger did not occur before setup expiry.', source: 'Upstox daily candles', validation: candleResult.validation });
  const updated = await prisma.strategySignal.update({ where: { id }, data: { outcomeStatus: enteredAt ? 'triggered' : 'pending', outcomeJson: JSON.stringify({ enteredAt, entryPrice: entryPrice == null ? null : roundMoney(entryPrice), checkedAt: new Date().toISOString(), maximumHoldingBars, costsApplied: Boolean(costs), source: 'Upstox daily candles', validation: candleResult.validation }) } });
  return toSignal(updated);
}

export async function createTradeJournalEntry(identity: string, data: {
  signalId?: string;
  instrumentKey?: string;
  ticker?: string;
  strategyId?: string;
  strategyVersion?: string;
  actualEntry: number;
  actualExit?: number;
  quantity: number;
  actualCharges?: number;
  entryAt: Date;
  exitAt?: Date;
  notes?: string;
}) {
  const ownerKey = memoryOwnerKey(identity);
  if (!(Number.isFinite(data.actualEntry) && data.actualEntry > 0)) throw new JournalInputError('Actual entry must be a positive number.');
  if (!(Number.isInteger(data.quantity) && data.quantity > 0)) throw new JournalInputError('Quantity must be a positive whole number.');
  if (data.actualExit != null && (!(Number.isFinite(data.actualExit)) || data.actualExit <= 0)) throw new JournalInputError('Actual exit must be a positive number.');
  if (data.actualCharges != null && (!(Number.isFinite(data.actualCharges)) || data.actualCharges < 0)) throw new JournalInputError('Actual charges cannot be negative.');
  if (!Number.isFinite(data.entryAt.getTime())) throw new JournalInputError('A valid entry timestamp is required.');
  if (data.entryAt.getTime() > Date.now() + 5 * 60_000) throw new JournalInputError('An actual trade entry timestamp cannot be in the future.');
  if ((data.actualExit == null) !== (data.exitAt == null)) throw new JournalInputError('Actual exit price and exit timestamp must be supplied together.');
  if (data.exitAt && (!Number.isFinite(data.exitAt.getTime()) || data.exitAt < data.entryAt)) throw new JournalInputError('Exit timestamp must be valid and cannot precede entry.');
  if (data.exitAt && data.exitAt.getTime() > Date.now() + 5 * 60_000) throw new JournalInputError('An actual trade exit timestamp cannot be in the future.');

  const signal = data.signalId
    ? await prisma.strategySignal.findFirst({ where: { id: data.signalId, ownerKey } })
    : null;
  if (data.signalId && !signal) throw new JournalInputError('The linked signal was not found for this browser identity.', 404);

  const instrumentKey = signal?.instrumentKey ?? data.instrumentKey?.trim();
  const ticker = signal?.ticker ?? data.ticker?.trim().toUpperCase();
  if (!instrumentKey || !ticker) throw new JournalInputError('Instrument key and ticker are required for a manual trade record.');

  const realizedPnl = data.actualExit != null ? (data.actualExit - data.actualEntry) * data.quantity - (data.actualCharges ?? 0) : undefined;
  return prisma.tradeJournal.create({
    data: {
      ownerKey,
      signalId: signal?.id,
      instrumentKey,
      ticker,
      strategyId: (signal?.strategyId ?? data.strategyId?.trim()) || undefined,
      strategyVersion: (signal?.strategyVersion ?? data.strategyVersion?.trim()) || undefined,
      actualEntry: data.actualEntry,
      actualExit: data.actualExit,
      quantity: data.quantity,
      actualCharges: data.actualCharges,
      realizedPnl,
      entryAt: data.entryAt,
      exitAt: data.exitAt,
      notes: data.notes?.trim() || undefined,
      userConfirmed: true,
    },
  });
}

export async function listTradeJournal(identity: string, limit = 100) {
  const ownerKey = memoryOwnerKey(identity);
  return prisma.tradeJournal.findMany({ where: { ownerKey }, orderBy: { entryAt: 'desc' }, take: Math.min(limit, 200) });
}

export async function deleteJournalRecord(identity: string, kind: 'signal' | 'trade', id: string) {
  const ownerKey = memoryOwnerKey(identity);
  return kind === 'signal'
    ? prisma.strategySignal.deleteMany({ where: { id, ownerKey } })
    : prisma.tradeJournal.deleteMany({ where: { id, ownerKey } });
}

async function closeShadow(id: string, status: 'target' | 'stop' | 'time_exit' | 'expired' | 'invalidated', outcome: Record<string, unknown>) {
  return toSignal(await prisma.strategySignal.update({ where: { id }, data: { outcomeStatus: status, outcomeJson: JSON.stringify(outcome), closedAt: new Date() } }));
}

function shadowExitForCandle(candle: { open: number; high: number; low: number }, stopPrice: number, targets: Array<{ price: number; label: string }>, entryPrice: number) {
  if (candle.low <= stopPrice) return { status: 'stop' as const, rawExit: Math.min(stopPrice, candle.open), target: null };
  const reached = [...targets]
    .filter((target) => target.price > entryPrice)
    .sort((a, b) => b.price - a.price)
    .find((target) => candle.high >= target.price);
  return reached ? { status: 'target' as const, rawExit: reached.price, target: reached.label } : null;
}

function buildShadowOutcome(params: {
  enteredAt: string;
  entryPrice: number;
  referenceEntry: number;
  candle: { timestamp: string };
  rawExit: number;
  target: string | null;
  stopPrice: number;
  costs: StrategySignalSetup['costs'];
  holdingBars: number;
  validation: unknown;
  reason?: string;
}) {
  const sellSlippageBps = params.costs?.slippageBpsPerSide ?? 0;
  const exitPrice = applySellSlippage(params.rawExit, sellSlippageBps);
  const buyCharges = params.entryPrice * (params.costs?.buyCostBps ?? 0) / 10_000;
  const sellCharges = exitPrice * (params.costs?.sellCostBps ?? 0) / 10_000;
  const estimatedChargesPerShare = buyCharges + sellCharges;
  const netPnlPerShare = exitPrice - params.entryPrice - estimatedChargesPerShare;
  const stopFill = applySellSlippage(params.stopPrice, sellSlippageBps);
  const plannedNetRisk = Math.max(.01, params.entryPrice - stopFill + buyCharges + stopFill * (params.costs?.sellCostBps ?? 0) / 10_000);
  return {
    enteredAt: params.enteredAt,
    entryPrice: roundMoney(params.entryPrice),
    referenceEntry: roundMoney(params.referenceEntry),
    exitedAt: params.candle.timestamp,
    exitPrice: roundMoney(exitPrice),
    referenceExit: roundMoney(params.rawExit),
    target: params.target,
    reason: params.reason ?? null,
    holdingBars: params.holdingBars,
    grossReturnPct: roundMetric((params.rawExit / params.referenceEntry - 1) * 100),
    netReturnPct: roundMetric(netPnlPerShare / params.entryPrice * 100),
    netPnlPerShare: roundMoney(netPnlPerShare),
    rMultiple: roundMetric(netPnlPerShare / plannedNetRisk),
    estimatedChargesPerShare: roundMoney(estimatedChargesPerShare),
    slippageBpsPerSide: sellSlippageBps,
    source: 'Upstox daily candles',
    executionModel: 'Signal at completed daily close; hypothetical entry at next daily open; stop before target on same candle; configured costs and two-sided slippage applied.',
    validation: params.validation,
  };
}

function applyBuySlippage(price: number, bps: number) { return price * (1 + bps / 10_000); }
function applySellSlippage(price: number, bps: number) { return price * (1 - bps / 10_000); }
function roundMoney(value: number) { return Math.round(value * 100) / 100; }
function roundMetric(value: number) { return Math.round(value * 1_000) / 1_000; }
function toSignal(record: Awaited<ReturnType<typeof prisma.strategySignal.findFirst>> & {}): StrategySignalRecord {
  const value = record!;
  return { id: value.id, instrumentKey: value.instrumentKey, ticker: value.ticker, exchange: value.exchange, strategyId: value.strategyId, strategyVersion: value.strategyVersion, decisionStatus: value.decisionStatus, mode: value.mode as 'shadow' | 'research', marketTimestamp: value.marketTimestamp.toISOString(), detectedAt: value.detectedAt.toISOString(), setup: parseRecord<StrategySignalSetup>(value.setupJson), snapshot: parseRecord<StrategySignalSnapshot>(value.snapshotJson), outcomeStatus: value.outcomeStatus as StrategySignalRecord['outcomeStatus'], outcome: value.outcomeJson ? parseRecord<Record<string, unknown>>(value.outcomeJson) : null, closedAt: value.closedAt?.toISOString() ?? null };
}
function parseRecord<T extends object>(value: string): T { try { const parsed = JSON.parse(value); return (parsed && typeof parsed === 'object' ? parsed : {}) as T; } catch { return {} as T; } }
