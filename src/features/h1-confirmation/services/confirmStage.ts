import { routeEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import type { H1ConfirmState, H1Counters, H1Decision, H1State, Stage8Handoff } from '../types';
import { getH1Snapshot, h1StageStatus, type H1StageStatus } from './confirmStore';

/** Stage 7 → Stage 8 output: H1 confirmations only; Stage 7 never executes. */
export type Stage7Output = {
  status: H1StageStatus;
  runAt: string | null;
  decisions: H1Decision[];
  counters: H1Counters | null;
  confirmed: Stage8Handoff[];
};

export function stage7Output(now = Date.now()): Stage7Output {
  const snap = getH1Snapshot();
  const list = snap.state?.instruments ?? [];
  return {
    status: h1StageStatus(snap, now),
    runAt: snap.state?.run?.runAt ?? null,
    decisions: list,
    counters: snap.state?.run?.counters ?? null,
    confirmed: list
      .filter((d) => d.state === 'CONFIRMED' && d.confirmed && d.handoff)
      .map((d) => ({ ...(d.handoff as Stage8Handoff), confirmedSince: d.confirmedSince ?? null })),
  };
}

export const h1Tone = (s?: H1State | string | null) =>
  s === 'CONFIRMED'
    ? 'green'
    : s === 'CONFIRMING' || s === 'SETUP_FORMING'
      ? 'blue'
      : s === 'MONITORING' || s === 'PULLBACK' || s === 'WARMING_UP' || s === 'STALE' || s === 'WAITING_FOR_STAGE6'
        ? 'amber'
        : s === 'REJECTED' || s === 'INVALIDATED' || s === 'BLOCKED'
          ? 'red'
          : 'gray';

export const gateTone = (s?: string) => (s === 'PASS' ? 'green' : s === 'FAIL' ? 'red' : s === 'WAIT' || s === 'STALE' ? 'amber' : 'gray');

export const stateLabel = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');

const signatures = new Map<string, string>();
let lastRunAt: string | null = null;

function emit(symbol: string | undefined, detail: string, extra: Record<string, unknown>) {
  const routed = routeEvent('CONFIRMATION_CHANGE');
  eventBus.emit({
    id: `s7-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'CONFIRMATION_CHANGE',
    symbol,
    at: new Date().toISOString(),
    payload: { source: 'confirmation', detail, stage: 7, stages: routed.stages, priority: routed.priority, ...extra },
  });
}

/** Publish Stage 7 runs and per-instrument state changes; the orchestrator routes CONFIRMATION_CHANGE to Stages 7–8. */
export function publishStage7(state: H1ConfirmState | null) {
  const run = state?.run;
  if (!state || !run?.runAt) return;
  const firstPass = lastRunAt == null;
  if (run.runAt !== lastRunAt) {
    lastRunAt = run.runAt;
    const c = run.counters;
    emit(
      undefined,
      c
        ? `Stage 7 H1 confirmation (${run.triggers?.slice(0, 3).join(', ') || 'run'}): ${c.candidates} Stage 6 candidates · ${c.monitoring} monitoring · ${c.confirmed} CONFIRMED → Opportunities & Risk · ${c.rejected} rejected · ${c.invalidated} invalidated`
        : run.message,
      { runAt: run.runAt, confirmed: run.confirmedNow },
    );
  }
  for (const d of state.instruments) {
    const sig = `${d.state}|${d.reasonCode ?? ''}`;
    const prev = signatures.get(d.symbol);
    signatures.set(d.symbol, sig);
    if (firstPass || !prev || prev === sig) continue;
    const [pState] = prev.split('|');
    emit(d.symbol, `${d.symbol} H1 ${pState} → ${d.state} · ${d.reasonCode}: ${d.reason}`, {
      state: d.state,
      direction: d.expectedDirection,
      score: d.score,
      confirmed: d.confirmed,
      invalidationLevel: d.invalidationLevel,
    });
  }
}
