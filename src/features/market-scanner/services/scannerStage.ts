import { routeEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import type { ScannerCounters, ScannerDirection, ScannerInstrument, ScannerStateResponse } from '../types';
import { getScannerSnapshot, scannerStageStatus, type ScannerStageStatus } from './scannerStore';

/** Stage 4 → Stage 5 output: ranking and promotion only; Stage 4 never executes. */
export type Stage4Output = {
  status: ScannerStageStatus;
  runAt: string | null;
  instruments: ScannerInstrument[];
  counters: ScannerCounters | null;
  promoted: ScannerInstrument[];
  qualified: number;
  blocked: number;
};

/** The instrument the autonomous pipeline is watching: the best promoted pair, otherwise rank 1. */
export function pipelineFocusSymbol(): string | null {
  const list = getScannerSnapshot().state?.instruments ?? [];
  if (!list.length) return null;
  const promoted = list.filter((i) => i.state === 'PROMOTED');
  const pool = promoted.length ? promoted : list;
  return [...pool].sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol))[0]?.symbol ?? null;
}

export function stage4Output(now = Date.now()): Stage4Output {
  const snap = getScannerSnapshot();
  const list = snap.state?.instruments ?? [];
  return {
    status: scannerStageStatus(snap, now),
    runAt: snap.state?.run?.runAt ?? null,
    instruments: list,
    counters: snap.state?.run?.counters ?? null,
    promoted: list.filter((i) => i.state === 'PROMOTED'),
    qualified: list.filter((i) => i.state === 'QUALIFIED').length,
    blocked: list.filter((i) => i.state === 'BLOCKED' || i.state === 'STALE' || i.state === 'INSUFFICIENT_DATA').length,
  };
}

export const directionTone = (d: ScannerDirection | string | null | undefined) =>
  d === 'STRONG_BULLISH' || d === 'BULLISH' ? 'green' : d === 'STRONG_BEARISH' || d === 'BEARISH' ? 'red' : 'gray';

const signatures = new Map<string, string>();
let lastRunAt: string | null = null;

function emit(symbol: string | undefined, detail: string, extra: Record<string, unknown>) {
  const routed = routeEvent('SCANNER_CHANGE');
  eventBus.emit({
    id: `s4-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'SCANNER_CHANGE',
    symbol,
    at: new Date().toISOString(),
    payload: { source: 'scanner', detail, stage: 4, stages: routed.stages, priority: routed.priority, ...extra },
  });
}

/** Publish Stage 4 re-ranks and per-instrument promotion/state changes; the orchestrator routes SCANNER_CHANGE to Stages 4–5. */
export function publishStage4(state: ScannerStateResponse | null) {
  const run = state?.run;
  if (!state || !run?.runAt) return;
  const firstPass = lastRunAt == null;
  if (run.runAt !== lastRunAt) {
    lastRunAt = run.runAt;
    const c = run.counters;
    emit(
      undefined,
      `Stage 4 re-rank (${run.triggers?.slice(0, 3).join(', ') || 'run'}): ${c.available}/${c.universe} available · ${c.directional} directional · ${c.promoted} promoted → HTF Market Vision`,
      { runAt: run.runAt, promoted: run.promotedNow },
    );
  }
  for (const i of state.instruments) {
    const sig = `${i.state}|${i.direction}`;
    const prev = signatures.get(i.symbol);
    signatures.set(i.symbol, sig);
    if (firstPass || !prev || prev === sig) continue;
    const [pState, pDir] = prev.split('|');
    emit(i.symbol, `${i.symbol} ${pState}/${pDir} → ${i.state}/${i.direction} · conviction ${i.conviction?.toFixed(0) ?? '—'} · ${i.reason}`, {
      state: i.state,
      direction: i.direction,
      conviction: i.conviction,
      promoted: i.state === 'PROMOTED',
    });
  }
}
