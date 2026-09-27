import { routeEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import type { DirectionCounters, DirectionDecision, DirectionState, ProcessingState, Stage7Handoff } from '../types';
import { getDirectionSnapshot, directionStageStatus, type DirectionStageStatus } from './directionStore';

/** Stage 6 → Stage 7 output: structural decisions only; Stage 6 never executes. */
export type Stage6Output = {
  status: DirectionStageStatus;
  runAt: string | null;
  decisions: DirectionDecision[];
  counters: DirectionCounters | null;
  ready: Stage7Handoff[];
};

export function stage6Output(now = Date.now()): Stage6Output {
  const snap = getDirectionSnapshot();
  const list = snap.state?.instruments ?? [];
  return {
    status: directionStageStatus(snap, now),
    runAt: snap.state?.run?.runAt ?? null,
    decisions: list,
    counters: snap.state?.run?.counters ?? null,
    ready: list.filter((d) => d.readyForH1 && d.handoff).map((d) => ({ ...(d.handoff as Stage7Handoff), readySince: d.readySince ?? null })),
  };
}

export const stateTone = (s?: ProcessingState | string | null) =>
  s === 'READY_FOR_H1'
    ? 'green'
    : s === 'ALIGNED'
      ? 'blue'
      : s === 'WAITING' || s === 'ANALYSING' || s === 'STALE'
        ? 'amber'
        : s === 'CONFLICT' || s === 'BLOCKED' || s === 'INVALIDATED'
          ? 'red'
          : 'gray';

const signatures = new Map<string, string>();
let lastRunAt: string | null = null;

function emit(symbol: string | undefined, detail: string, extra: Record<string, unknown>) {
  const routed = routeEvent('DIRECTION_CHANGE');
  eventBus.emit({
    id: `s6-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'DIRECTION_CHANGE',
    symbol,
    at: new Date().toISOString(),
    payload: { source: 'direction', detail, stage: 6, stages: routed.stages, priority: routed.priority, ...extra },
  });
}

/** Publish Stage 6 runs and per-instrument decision changes; the orchestrator routes DIRECTION_CHANGE to Stages 6–7. */
export function publishStage6(state: DirectionState | null) {
  const run = state?.run;
  if (!state || !run?.runAt) return;
  const firstPass = lastRunAt == null;
  if (run.runAt !== lastRunAt) {
    lastRunAt = run.runAt;
    const c = run.counters;
    emit(
      undefined,
      c
        ? `Stage 6 decision (${run.triggers?.slice(0, 3).join(', ') || 'run'}): ${c.candidates} candidates · ${c.aligned} aligned · ${c.pullbackWaiting} pullback/waiting · ${c.conflicts} conflicts · ${c.ready} READY_FOR_H1 → H1 Confirmation`
        : run.message,
      { runAt: run.runAt, ready: run.readyNow },
    );
  }
  for (const d of state.instruments) {
    const sig = `${d.state}|${d.direction}|${d.structuralPhase ?? ''}`;
    const prev = signatures.get(d.symbol);
    signatures.set(d.symbol, sig);
    if (firstPass || !prev || prev === sig) continue;
    const [pState, pDir] = prev.split('|');
    emit(d.symbol, `${d.symbol} ${pState}/${pDir} → ${d.state}/${d.direction} · ${d.reasonCode}: ${d.reason}`, {
      state: d.state,
      direction: d.direction,
      phase: d.structuralPhase,
      confidence: d.confidence,
      readyForH1: d.readyForH1,
    });
  }
}
