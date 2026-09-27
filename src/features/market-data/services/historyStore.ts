import { useSyncExternalStore } from 'react';
import { routeEvent, type MarketEvent } from '../../../engine/orchestrator';
import { eventBus, type TradingEventType } from '../../../services/eventBus';
import {
  fetchHistoryEvents,
  fetchHistoryStatus,
  type HistoryEvent,
  type HistoryInstrument,
  type HistoryStatus,
  type HistoryStatusCode,
} from './historyClient';

/** The bridge synchronizes autonomously; the UI only observes it. */
export const HISTORY_POLL_MS = 5_000;

export type HistoryStoreSnapshot = {
  status: HistoryStatus | null;
  events: HistoryEvent[];
  loading: boolean;
  error: string;
  lastFetchAt: number | null;
};

let snapshot: HistoryStoreSnapshot = { status: null, events: [], loading: true, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;
let cursor = 0;
let inflight = false;

function set(patch: Partial<HistoryStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeHistory(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getHistorySnapshot = () => snapshot;

export function useHistoryStore(): HistoryStoreSnapshot {
  return useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
}

const CLOSE_EVENT: Record<string, { bus: TradingEventType; route: MarketEvent }> = {
  MN1: { bus: 'MN_CLOSE', route: 'MONTH_CLOSE' },
  W1: { bus: 'W1_CLOSE', route: 'W1_CLOSE' },
  D1: { bus: 'D1_CLOSE', route: 'D1_CLOSE' },
  H8: { bus: 'H8_CLOSE', route: 'H8_CLOSE' },
  H1: { bus: 'H1_CLOSE', route: 'H1_CLOSE' },
  M15: { bus: 'M15_CLOSE', route: 'M15_CLOSE' },
  M5: { bus: 'M5_CLOSE', route: 'M5_CLOSE' },
};

/** Publish persisted bridge events to the Workflow Engine bus with orchestrator routing. */
function publish(e: HistoryEvent) {
  const close = e.kind === 'CANDLE_CLOSED' && e.timeframe ? CLOSE_EVENT[e.timeframe] : undefined;
  const routed = routeEvent(close ? close.route : 'DATA_EVENT');
  eventBus.emit({
    id: `hist-${e.id}`,
    type: close ? close.bus : 'DATA_EVENT',
    symbol: e.symbol ?? undefined,
    at: e.at,
    payload: {
      source: 'history',
      kind: e.kind,
      severity: e.severity,
      timeframe: e.timeframe,
      detail: e.message,
      stage: routed.stages[0] ?? 1,
      stages: routed.stages,
    },
  });
}

async function poll() {
  if (inflight) return;
  inflight = true;
  try {
    const first = cursor === 0;
    const [status, fresh] = await Promise.all([fetchHistoryStatus(), fetchHistoryEvents(cursor, first ? 60 : 200)]);
    if (fresh.length) {
      cursor = fresh[fresh.length - 1].id;
      if (!first) fresh.forEach(publish);
    }
    const events = [...fresh.slice().reverse(), ...snapshot.events].slice(0, 200);
    set({ status, events, loading: false, error: status.ok ? '' : status.message || 'History status unavailable', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : 'History status unavailable' });
  } finally {
    inflight = false;
  }
}

export const refreshHistory = () => poll();

/** Ref-counted: the first caller starts polling, the last one stops it. */
export function startHistoryStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void poll();
    timer = setInterval(() => void poll(), HISTORY_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export type HistoryGate = {
  pass: boolean;
  code: HistoryStatusCode;
  reason: string;
};

/** Stage 1 per-instrument history readiness. Fail-closed while status is unknown. */
export function getInstrumentHistoryGate(symbol: string, s: HistoryStoreSnapshot = snapshot): HistoryGate {
  const status = s.status;
  const stale = s.lastFetchAt == null || Date.now() - s.lastFetchAt > HISTORY_POLL_MS * 6;
  if (!status || stale) {
    return s.error || (stale && s.lastFetchAt != null)
      ? { pass: false, code: 'PROVIDER_OFFLINE', reason: `History service unreachable${s.error ? `: ${s.error}` : ''}` }
      : { pass: false, code: 'WARMING_UP', reason: 'Historical data status loading' };
  }
  if (!status.provider.connected) {
    return { pass: false, code: 'PROVIDER_OFFLINE', reason: status.provider.message || 'MT5 provider offline' };
  }
  const inst: HistoryInstrument | undefined = status.instruments.find((i) => i.symbol === symbol);
  if (!inst) return { pass: false, code: 'MISSING_HISTORY', reason: 'Instrument not tracked by historical synchronizer' };
  if (inst.ready) return { pass: true, code: 'READY', reason: 'History available · complete · valid · fresh' };
  return { pass: false, code: inst.status, reason: inst.reason };
}

export function historyReadyCount(s: HistoryStoreSnapshot = snapshot) {
  const inst = s.status?.instruments ?? [];
  return { ready: inst.filter((i) => i.ready).length, total: inst.length };
}
