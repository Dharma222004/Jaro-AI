'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { getMemoryIdentity, memoryAuthorization } from '@/lib/memory/client';
import type { StrategySignalRecord, TradeJournalRecord } from '@/types/journal';

interface TradeDraft {
  signalId: string;
  instrumentKey: string;
  ticker: string;
  strategyId: string;
  strategyVersion: string;
  actualEntry: string;
  actualExit: string;
  quantity: string;
  actualCharges: string;
  entryAt: string;
  exitAt: string;
  notes: string;
}

const EMPTY_TRADE: TradeDraft = {
  signalId: '',
  instrumentKey: '',
  ticker: '',
  strategyId: '',
  strategyVersion: '',
  actualEntry: '',
  actualExit: '',
  quantity: '',
  actualCharges: '',
  entryAt: '',
  exitAt: '',
  notes: '',
};

export default function JournalPage() {
  const [signals, setSignals] = useState<StrategySignalRecord[]>([]);
  const [trades, setTrades] = useState<TradeJournalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [draft, setDraft] = useState<TradeDraft>(EMPTY_TRADE);
  const formRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/journal', {
        headers: memoryAuthorization(getMemoryIdentity()),
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The journal could not be loaded.');
      setSignals(Array.isArray(data.signals) ? data.signals : []);
      setTrades(Array.isArray(data.trades) ? data.trades : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The journal could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => { cancelled = true; };
  }, [load]);

  const refreshSignal = async (id: string) => {
    setBusy(`refresh:${id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/journal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...memoryAuthorization() },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The shadow outcome could not be refreshed.');
      setNotice('Shadow outcome refreshed from subsequent validated Upstox daily candles.');
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'The shadow outcome could not be refreshed.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: 'signal' | 'trade', id: string) => {
    const label = kind === 'signal' ? 'research signal' : 'user-recorded trade';
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setBusy(`delete:${id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/journal?kind=${kind}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: memoryAuthorization(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `The ${label} could not be deleted.`);
      if (data.deleted !== 1) throw new Error(`The ${label} was not found for this browser identity.`);
      setNotice(`${kind === 'signal' ? 'Research signal' : 'Trade record'} deleted.`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `The ${label} could not be deleted.`);
    } finally {
      setBusy(null);
    }
  };

  const openTradeForm = (signal?: StrategySignalRecord) => {
    setDraft(signal ? {
      ...EMPTY_TRADE,
      signalId: signal.id,
      instrumentKey: signal.instrumentKey,
      ticker: signal.ticker,
      strategyId: signal.strategyId,
      strategyVersion: signal.strategyVersion,
    } : EMPTY_TRADE);
    setError(null);
    setNotice(null);
    setShowTradeForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const submitTrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('create-trade');
    setError(null);
    setNotice(null);
    try {
      const payload = {
        signalId: draft.signalId || undefined,
        instrumentKey: draft.instrumentKey || undefined,
        ticker: draft.ticker || undefined,
        strategyId: draft.strategyId || undefined,
        strategyVersion: draft.strategyVersion || undefined,
        actualEntry: draft.actualEntry,
        actualExit: draft.actualExit || undefined,
        quantity: draft.quantity,
        actualCharges: draft.actualCharges || undefined,
        entryAt: toIso(draft.entryAt, 'entry'),
        exitAt: draft.exitAt ? toIso(draft.exitAt, 'exit') : undefined,
        notes: draft.notes || undefined,
      };
      const response = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...memoryAuthorization() },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The trade could not be recorded.');
      setDraft(EMPTY_TRADE);
      setShowTradeForm(false);
      setNotice('User-confirmed trade recorded separately from the research signal.');
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The trade could not be recorded.');
    } finally {
      setBusy(null);
    }
  };

  const monitoredSignals = signals.filter((signal) => signal.outcomeStatus === 'pending' || signal.outcomeStatus === 'triggered').length;
  const closedTrades = trades.filter((trade) => trade.actualExit != null).length;
  const realizedPnl = trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);
  const linkedSignal = draft.signalId ? signals.find((signal) => signal.id === draft.signalId) : undefined;

  return (
    <div className="page-container journal-page">
      <header className="section-page-header journal-page-header">
        <div>
          <span className="section-eyebrow">Systematic research records</span>
          <h1>Strategy &amp; Trade Journal</h1>
          <p>Audit shadow-mode signals and keep user-confirmed executions in a separate record.</p>
        </div>
        <button className="btn-primary" onClick={() => openTradeForm()} type="button">
          <Plus size={15} /> Record actual trade
        </button>
      </header>

      <div className="journal-summary-grid" aria-label="Journal summary">
        <SummaryCard label="Research signals" value={signals.length.toLocaleString('en-IN')} note="Immutable detection snapshots" />
        <SummaryCard label="Monitoring" value={monitoredSignals.toLocaleString('en-IN')} note="Pending or hypothetically triggered" />
        <SummaryCard label="Actual trades" value={trades.length.toLocaleString('en-IN')} note={`${closedTrades} explicitly closed`} />
        <SummaryCard label="Recorded realized P/L" value={money(realizedPnl)} note="From user-entered fills and charges" tone={realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : undefined} />
      </div>

      <div className="journal-safeguard" role="note">
        <ShieldCheck size={18} />
        <div>
          <strong>Authenticated User Row-Level Isolation</strong>
          <span>Research signals and user-confirmed trade executions are cryptographically isolated and authorized to your user account. Research scenarios never automatically alter trade history.</span>
        </div>
      </div>

      {error && (
        <div className="journal-feedback error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button className="btn-retry-inline" onClick={() => void load()} type="button">
            <RefreshCw size={12} />
            <span>Retry</span>
          </button>
        </div>
      )}
      {notice && <div className="journal-feedback success" role="status"><CheckCircle2 size={16} /><span>{notice}</span></div>}

      {showTradeForm && (
        <section className="card journal-create-card" ref={formRef}>
          <div className="journal-create-heading">
            <div>
              <span className="section-eyebrow">Explicit user record</span>
              <h2>Record an actual trade</h2>
              <p>Enter broker-confirmed fills, quantity, timestamps and charges. Planned levels are never copied into actual-fill fields.</p>
            </div>
            <button className="icon-button" aria-label="Close actual trade form" onClick={() => setShowTradeForm(false)} type="button"><X size={16} /></button>
          </div>

          {linkedSignal && (
            <div className="journal-linked-signal">
              <FileCheck2 size={16} />
              <div><strong>Linked to {linkedSignal.exchange}:{linkedSignal.ticker} · {strategyLabel(linkedSignal.strategyId)}</strong><span>{linkedSignal.strategyVersion} · detected {dateTime(linkedSignal.detectedAt)}</span></div>
            </div>
          )}

          <form className="journal-trade-form" onSubmit={submitTrade}>
            {!draft.signalId && <>
              <Field label="Ticker" required><input value={draft.ticker} onChange={(event) => updateDraft(setDraft, 'ticker', event.target.value.toUpperCase())} placeholder="GAIL" maxLength={40} required /></Field>
              <Field label="Upstox instrument key" required wide><input value={draft.instrumentKey} onChange={(event) => updateDraft(setDraft, 'instrumentKey', event.target.value)} placeholder="NSE_EQ|INE129A01019" maxLength={200} required /></Field>
            </>}
            <Field label="Actual entry price" required><input type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.actualEntry} onChange={(event) => updateDraft(setDraft, 'actualEntry', event.target.value)} placeholder="0.00" required /></Field>
            <Field label="Quantity" required><input type="number" inputMode="numeric" min="1" step="1" value={draft.quantity} onChange={(event) => updateDraft(setDraft, 'quantity', event.target.value)} placeholder="0" required /></Field>
            <Field label="Entry timestamp" required><input type="datetime-local" value={draft.entryAt} onChange={(event) => updateDraft(setDraft, 'entryAt', event.target.value)} required /></Field>
            <Field label="Actual charges"><input type="number" inputMode="decimal" min="0" step="0.01" value={draft.actualCharges} onChange={(event) => updateDraft(setDraft, 'actualCharges', event.target.value)} placeholder="Optional" /></Field>
            <Field label="Actual exit price"><input type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.actualExit} onChange={(event) => setDraft((current) => ({ ...current, actualExit: event.target.value, exitAt: event.target.value ? current.exitAt : '' }))} placeholder="Leave blank if open" /></Field>
            <Field label="Exit timestamp"><input type="datetime-local" value={draft.exitAt} onChange={(event) => updateDraft(setDraft, 'exitAt', event.target.value)} disabled={!draft.actualExit} required={Boolean(draft.actualExit)} /></Field>
            <Field label="Execution or process notes" full><textarea value={draft.notes} onChange={(event) => updateDraft(setDraft, 'notes', event.target.value)} placeholder="Optional: slippage, early-exit reason, process observation or emotion noted by you." maxLength={2_000} rows={3} /></Field>
            <div className="journal-form-actions">
              <button className="btn-ghost" onClick={() => setShowTradeForm(false)} type="button">Cancel</button>
              <button className="btn-primary" disabled={busy === 'create-trade'} type="submit">{busy === 'create-trade' && <RefreshCw className="animate-spin" size={14} />} Save user-confirmed trade</button>
            </div>
          </form>
        </section>
      )}

      <section className="journal-section" aria-labelledby="shadow-signals-heading">
        <div className="journal-section-heading">
          <div><span className="section-eyebrow">Paper observation</span><h2 id="shadow-signals-heading">Shadow-mode signals</h2><p>Original levels and decisions are retained; refresh only appends subsequent hypothetical outcomes.</p></div>
          <button className="icon-button" aria-label="Reload journal" disabled={loading} onClick={load} type="button"><RefreshCw className={loading ? 'animate-spin' : ''} size={15} /></button>
        </div>

        {loading ? <JournalLoading label="Loading shadow signals…" /> : signals.length === 0 ? (
          <div className="card memory-empty"><FileCheck2 size={24} /><strong>No shadow signals recorded</strong><span>Systematic research scenarios generated in chat will appear here.</span></div>
        ) : (
          <div className="journal-list">{signals.map((signal) => <SignalRow busy={busy} key={signal.id} onDelete={remove} onRecord={openTradeForm} onRefresh={refreshSignal} signal={signal} />)}</div>
        )}
      </section>

      <section className="journal-section" aria-labelledby="actual-trades-heading">
        <div className="journal-section-heading">
          <div><span className="section-eyebrow">User supplied</span><h2 id="actual-trades-heading">Actual trade records</h2><p>Only fills explicitly entered by the user are shown here; these are not broker-verified automatically.</p></div>
        </div>

        {loading ? <JournalLoading label="Loading actual trade records…" /> : trades.length === 0 ? (
          <div className="card memory-empty"><ShieldCheck size={24} /><strong>No user-confirmed trades recorded</strong><span>Research scenarios are never treated as executions.</span></div>
        ) : (
          <div className="journal-list">{trades.map((trade) => <TradeRow busy={busy} key={trade.id} onDelete={remove} trade={trade} />)}</div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'positive' | 'negative' }) {
  return <div className="card journal-summary-card"><span>{label}</span><strong className={tone}>{value}</strong><small>{note}</small></div>;
}

function Field({ label, children, required = false, wide = false, full = false }: { label: string; children: ReactNode; required?: boolean; wide?: boolean; full?: boolean }) {
  return <label className={`journal-field${wide ? ' wide' : ''}${full ? ' full' : ''}`}><span>{label}{required && <em>Required</em>}</span>{children}</label>;
}

function SignalRow({ signal, busy, onRefresh, onRecord, onDelete }: {
  signal: StrategySignalRecord;
  busy: string | null;
  onRefresh: (id: string) => Promise<void>;
  onRecord: (signal: StrategySignalRecord) => void;
  onDelete: (kind: 'signal' | 'trade', id: string) => Promise<void>;
}) {
  const entry = signal.setup?.entry;
  const stop = signal.setup?.stop;
  const target = signal.setup?.targets?.[0];
  const passed = signal.setup?.gates?.filter((gate) => gate.status === 'pass').length ?? 0;
  const gates = signal.setup?.gates?.length ?? 0;
  return (
    <article className="card journal-row">
      <div className="journal-row-top">
        <div className="journal-row-badges"><span className="memory-type project">{signal.mode}</span><span className={`journal-status ${outcomeTone(signal.outcomeStatus)}`}>{humanize(signal.outcomeStatus)}</span></div>
        <time dateTime={signal.detectedAt}>{dateTime(signal.detectedAt)}</time>
      </div>
      <div className="journal-row-title"><div><h3>{signal.exchange}:{signal.ticker}</h3><p>{strategyLabel(signal.strategyId)} · {signal.strategyVersion}</p></div><strong className={decisionTone(signal.decisionStatus)}>{humanize(signal.decisionStatus)}</strong></div>
      <div className="journal-level-grid">
        <JournalMetric label="Observed price" value={money(signal.snapshot?.currentPrice)} />
        <JournalMetric label={entry?.zoneLabel ?? 'Setup zone'} value={entry ? `${money(entry.zoneLow)}–${money(entry.zoneHigh)}` : 'Not available'} />
        <JournalMetric label="Trigger / max" value={entry ? `${money(entry.triggerPrice)} / ${money(entry.maximumEntryPrice)}` : 'Not available'} />
        <JournalMetric label="Stop / target 1" value={stop ? `${money(stop.price)} / ${target ? money(target.price) : 'N/A'}` : 'Not available'} />
      </div>
      <div className="journal-row-meta"><span>Market data {dateTime(signal.marketTimestamp)}</span><span>{signal.snapshot?.marketDataStatus ?? 'Status unavailable'}</span><span>{passed}/{gates} gates passed</span>{target && <span>Net R/R {target.netRewardRisk}:1</span>}{signal.setup?.audit?.inputsHash && <span>Audit {signal.setup.audit.inputsHash}</span>}</div>
      <div className="journal-outcome"><strong>Shadow outcome: {humanize(signal.outcomeStatus)}</strong><span>{outcomeDescription(signal)}</span></div>
      <div className="journal-row-actions">
        <button className="btn-secondary" disabled={busy != null} onClick={() => void onRefresh(signal.id)} type="button">{busy === `refresh:${signal.id}` ? <RefreshCw className="animate-spin" size={13} /> : <RefreshCw size={13} />} Refresh outcome</button>
        <button className="btn-ghost" disabled={busy != null} onClick={() => onRecord(signal)} type="button"><Plus size={13} /> Record actual trade</button>
        <button className="btn-ghost danger" disabled={busy != null} onClick={() => void onDelete('signal', signal.id)} type="button"><Trash2 size={13} /> Delete</button>
      </div>
    </article>
  );
}

function TradeRow({ trade, busy, onDelete }: { trade: TradeJournalRecord; busy: string | null; onDelete: (kind: 'signal' | 'trade', id: string) => Promise<void> }) {
  const pnlTone = (trade.realizedPnl ?? 0) > 0 ? 'positive' : (trade.realizedPnl ?? 0) < 0 ? 'negative' : undefined;
  return (
    <article className="card journal-row actual">
      <div className="journal-row-top"><div className="journal-row-badges"><span className="memory-type profile">user confirmed</span>{trade.signalId && <span className="journal-status neutral">linked signal</span>}</div><time dateTime={trade.entryAt}>{dateTime(trade.entryAt)}</time></div>
      <div className="journal-row-title"><div><h3>{trade.ticker}</h3><p>{trade.strategyId ? `${strategyLabel(trade.strategyId)}${trade.strategyVersion ? ` · ${trade.strategyVersion}` : ''}` : trade.instrumentKey}</p></div><strong className={trade.actualExit == null ? 'warning' : pnlTone}>{trade.actualExit == null ? 'Open record' : money(trade.realizedPnl)}</strong></div>
      <div className="journal-level-grid">
        <JournalMetric label="Actual entry" value={money(trade.actualEntry)} />
        <JournalMetric label="Actual exit" value={money(trade.actualExit)} />
        <JournalMetric label="Quantity" value={`${trade.quantity.toLocaleString('en-IN')} shares`} />
        <JournalMetric label="Actual charges" value={money(trade.actualCharges)} />
      </div>
      <div className="journal-row-meta"><span>Entry {dateTime(trade.entryAt)}</span>{trade.exitAt && <span>Exit {dateTime(trade.exitAt)}</span>}<span>Execution data supplied by user</span></div>
      {trade.notes && <p className="journal-notes">{trade.notes}</p>}
      <div className="journal-row-actions"><button className="btn-ghost danger" disabled={busy != null} onClick={() => void onDelete('trade', trade.id)} type="button"><Trash2 size={13} /> Delete</button></div>
    </article>
  );
}

function JournalMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function JournalLoading({ label }: { label: string }) {
  return <div className="card memory-empty"><RefreshCw className="animate-spin" size={22} /><span>{label}</span></div>;
}

function updateDraft(setDraft: Dispatch<SetStateAction<TradeDraft>>, field: keyof TradeDraft, value: string) {
  setDraft((current) => ({ ...current, [field]: value }));
}

function toIso(value: string, label: string) {
  if (!value) throw new Error(`A valid ${label} timestamp is required.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`A valid ${label} timestamp is required.`);
  return date.toISOString();
}

function strategyLabel(value: string) {
  return humanize(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase();
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable';
}

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? 'N/A' : `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function outcomeTone(status: StrategySignalRecord['outcomeStatus']) {
  if (status === 'target') return 'positive';
  if (status === 'stop' || status === 'invalidated' || status === 'rejected') return 'negative';
  if (status === 'triggered' || status === 'time_exit' || status === 'expired') return 'warning';
  return 'neutral';
}

function decisionTone(status: string) {
  if (status === 'ENTRY_AVAILABLE') return 'positive';
  if (status === 'SETUP_INVALIDATED' || status === 'NO_VALID_SETUP') return 'negative';
  return 'warning';
}

function outcomeDescription(signal: StrategySignalRecord) {
  const outcome = signal.outcome;
  if (!outcome) return 'No subsequent outcome check has been stored.';
  if (typeof outcome.reason === 'string') return outcome.reason;
  if (typeof outcome.exitPrice === 'number') return `Hypothetical exit ${money(outcome.exitPrice)}${typeof outcome.netReturnPct === 'number' ? ` · net ${outcome.netReturnPct.toFixed(2)}% after configured costs/slippage` : ''}; this was not an actual execution.`;
  if (typeof outcome.enteredAt === 'string') return `Hypothetical trigger tracked from ${dateTime(outcome.enteredAt)}; this was not an actual execution.`;
  if (typeof outcome.checkedAt === 'string') return `Last checked ${dateTime(outcome.checkedAt)}; no qualifying hypothetical exit was observed.`;
  return 'Outcome metadata is stored without changing the original signal.';
}
