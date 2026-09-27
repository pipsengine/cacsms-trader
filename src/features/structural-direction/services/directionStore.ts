import { useSyncExternalStore } from 'react';
import type { DirectionDecision, DirectionState } from '../types';
import { fetchDirectionState, runDirection } from './directionClient';

/** The bridge decides autonomously; the UI only reads persisted Stage 6 state. */
export const DIRECTION_POLL_MS = 10_000;
/** The bridge sweeps at least every 5 minutes; beyond this the engine is not running. */
export const DIRECTION_STALE_MS = 10 * 60_000;

export type DirectionStoreSnapshot = {
  state: DirectionState | null;
  loading: boolean;
  running: boolean;
  error: string;
  lastFetchAt: number | null;
};

export type DirectionStageStatus = 'WAITING' | 'HEALTHY' | 'DEGRADED' | 'STALE' | 'ERROR';

let snapshot: DirectionStoreSnapshot = { state: null, loading: true, running: false, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<DirectionStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeDirection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getDirectionSnapshot = () => snapshot;

export function useDirectionStore(): DirectionStoreSnapshot {
  return useSyncExternalStore(subscribeDirection, getDirectionSnapshot, getDirectionSnapshot);
}

async function load() {
  try {
    const state = await fetchDirectionState();
    set({ state, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : 'Structural Direction state unavailable' });
  }
}

export async function runDirectionNow() {
  if (snapshot.running) return;
  set({ running: true });
  try {
    const r = await runDirection();
    set({ state: r.state, running: false, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ running: false, error: e instanceof Error ? e.message : 'Structural Direction run failed' });
  }
}

/** Ref-counted polling of the persisted Stage 6 state. */
export function startDirectionStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), DIRECTION_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function directionRunAgeMs(s: DirectionStoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function directionStageStatus(s: DirectionStoreSnapshot = snapshot, now = Date.now()): DirectionStageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  if (s.error) return 'ERROR';
  const run = s.state.run;
  if (!run) return 'WAITING';
  const age = directionRunAgeMs(s, now);
  if (age == null || age > DIRECTION_STALE_MS) return 'STALE';
  return run.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
}

export function getDirectionDecision(symbol: string): DirectionDecision | undefined {
  return snapshot.state?.instruments.find((i) => i.symbol === symbol);
}
