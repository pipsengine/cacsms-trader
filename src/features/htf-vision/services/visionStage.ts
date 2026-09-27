import { routeEvent, type MarketEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import type { Direction } from '../../../types';
import type { TfSummary, VisionDirection, VisionInstrument, VisionState } from '../types';
import { getVisionSnapshot, visionStageStatus, type VisionStageStatus } from './visionStore';

/** Stage 5 → Stage 6 output: structure only; Stage 5 never executes. */
export type Stage5Output = {
  status: VisionStageStatus;
  runAt: string | null;
  instruments: VisionInstrument[];
  qualified: number;
  confirmedD1: number;
  agree: number;
  conflict: number;
};

export function stage5Output(now = Date.now()): Stage5Output {
  const snap = getVisionSnapshot();
  const list = snap.state?.instruments ?? [];
  return {
    status: visionStageStatus(snap, now),
    runAt: snap.state?.run?.runAt ?? null,
    instruments: list,
    qualified: list.filter((i) => i.scanner?.qualified).length,
    confirmedD1: list.filter((i) => i.status === 'READY' && i.d1?.confirmed).length,
    agree: list.filter((i) => i.agreement === 'AGREE').length,
    conflict: list.filter((i) => i.agreement === 'CONFLICT').length,
  };
}

export function simpleDirection(d: VisionDirection | null | undefined): Direction {
  if (d === 'BULLISH' || d === 'STRONG_BULLISH') return 'BULLISH';
  if (d === 'BEARISH' || d === 'STRONG_BEARISH') return 'BEARISH';
  return 'NEUTRAL';
}

/** Directional only when the timeframe channel is confirmed on READY data. */
export function tfDirection(v: VisionInstrument | undefined, tf: 'd1' | 'h8'): Direction {
  if (!v || v.status !== 'READY') return 'NEUTRAL';
  const s: TfSummary | undefined = v[tf];
  return s?.confirmed ? simpleDirection(s.direction) : 'NEUTRAL';
}

/** Live D1 channel position (projected to the forming bar) or the last closed-bar position. */
export function visionPosition(v: VisionInstrument | undefined, tf: 'd1' | 'h8' = 'd1'): number | null {
  if (!v || v.status === 'BLOCKED' || v.status === 'INSUFFICIENT_DATA' || v.status === 'WARMING_UP') return null;
  const live = tf === 'd1' ? v.live?.positionD1 : v.live?.positionH8;
  const p = live ?? v[tf]?.position ?? null;
  return p == null || !Number.isFinite(p) ? null : p;
}

export type InstrumentVisionFields = { d1: Direction; h8: Direction; channelPos: number };

export function instrumentFields(v: VisionInstrument | undefined): InstrumentVisionFields {
  const p = visionPosition(v, 'd1');
  return { d1: tfDirection(v, 'd1'), h8: tfDirection(v, 'h8'), channelPos: p == null ? 0 : Math.round(p) };
}

const signatures = new Map<string, string>();
let lastRunAt: string | null = null;
let lastEventId = 0;

const breakSide = (s: TfSummary | undefined) => (s?.status === 'BROKEN' || s?.status === 'RETESTING' ? s.breakout?.side ?? '' : '');

type Stage5Event = Extract<MarketEvent, 'STRUCTURE_CHANGE' | 'CHANNEL_APPROACH' | 'CHANNEL_BREAK'>;

function emit(type: Stage5Event, symbol: string | undefined, detail: string, extra: Record<string, unknown>) {
  const routed = routeEvent(type);
  eventBus.emit({
    id: `s5-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    symbol,
    at: new Date().toISOString(),
    payload: { source: 'vision', detail, stage: 5, stages: routed.stages, priority: routed.priority, ...extra },
  });
}

/**
 * Publish Stage 5 structural changes to the Workflow Engine bus; the orchestrator routes
 * STRUCTURE_CHANGE to Stages 5–6, CHANNEL_APPROACH to 5–7 and CHANNEL_BREAK to 5–9.
 */
export function publishStage5(state: VisionState | null) {
  if (!state?.run?.runAt) return;
  const firstPass = lastRunAt == null;
  if (state.run.runAt !== lastRunAt) {
    lastRunAt = state.run.runAt;
    const s = state.run.summary;
    emit(
      'STRUCTURE_CHANGE',
      undefined,
      s
        ? `Stage 5 run ${state.run.triggers?.join(', ') || ''}: ${s.analysed} analysed · ${s.confirmedD1} confirmed D1 · ${s.agree} agree / ${s.conflict} conflict → Structural Direction`
        : state.run.message,
      { runAt: state.run.runAt },
    );
  }

  for (const v of state.instruments) {
    const sig = [v.status, v.primaryDirection, v.phase ?? '', v.d1?.status ?? '', v.h8?.status ?? '', breakSide(v.d1), breakSide(v.h8)].join('|');
    const prev = signatures.get(v.symbol);
    signatures.set(v.symbol, sig);
    if (firstPass || !prev || prev === sig) continue;
    const [pStatus, pDir, pPhase, pD1, pH8, pB1, pB8] = prev.split('|');
    const newBreak = (breakSide(v.d1) && breakSide(v.d1) !== pB1) || (breakSide(v.h8) && breakSide(v.h8) !== pB8);
    const detail = `${v.symbol} structure ${pStatus}/${pDir}/${pPhase || '—'} (D1 ${pD1 || '—'}, H8 ${pH8 || '—'}) → ${v.status}/${v.primaryDirection}/${
      v.phase ?? '—'
    } (D1 ${v.d1?.status ?? '—'}, H8 ${v.h8?.status ?? '—'})`;
    emit(newBreak ? 'CHANNEL_BREAK' : 'STRUCTURE_CHANGE', v.symbol, detail, {
      status: v.status,
      primaryDirection: v.primaryDirection,
      phase: v.phase,
      confidence: v.confidence,
    });
  }

  const fresh = state.events.filter((e) => e.id > lastEventId);
  if (fresh.length) lastEventId = Math.max(...fresh.map((e) => e.id));
  if (firstPass) return;
  for (const e of fresh) {
    if (e.type === 'BOUNDARY_APPROACH' || e.type === 'INTRABAR_BREACH') {
      emit('CHANNEL_APPROACH', e.symbol, `${e.symbol} ${e.timeframe}: ${e.detail}`, {
        timeframe: e.timeframe,
        visionEvent: e.type,
      });
    }
  }
}
