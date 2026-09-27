import { useSyncExternalStore } from 'react';
import type { H1ConfirmState, H1Decision } from '../types';
import { fetchH1State, runH1 } from './confirmClient';

/** The bridge confirms autonomously; the UI only reads persisted Stage 7 state. */
export const H1_POLL_MS = 10_000;
/** The bridge sweeps at least every 5 minutes; beyond this the engine is not running. */
export const H1_STALE_MS = 10 * 60_000;

export type H1StoreSnapshot = {
  state: H1ConfirmState | null;
  loading: boolean;
  running: boolean;
  error: string;
  lastFetchAt: number | null;
};

export type H1StageStatus = 'WAITING' | 'HEALTHY' | 'DEGRADED' | 'STALE' | 'ERROR';

let snapshot: H1StoreSnapshot = { state: null, loading: true, running: false, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<H1StoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeH1(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getH1Snapshot = () => snapshot;

export function useH1Store(): H1StoreSnapshot {
  return useSyncExternalStore(subscribeH1, getH1Snapshot, getH1Snapshot);
}

async function load() {
  try {
    const state = await fetchH1State();
    set({ state, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : 'H1 Confirmation state unavailable' });
  }
}

export async function runH1Now() {
  if (snapshot.running) return;
  set({ running: true });
  try {
    const r = await runH1();
    set({ state: r.state, running: false, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ running: false, error: e instanceof Error ? e.message : 'H1 Confirmation run failed' });
  }
}

/** Re-read the persisted state only; never triggers an engine run. */
export const refreshH1 = () => load();

/** Ref-counted polling of the persisted Stage 7 state. */
export function startH1Store(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), H1_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function h1RunAgeMs(s: H1StoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function h1StageStatus(s: H1StoreSnapshot = snapshot, now = Date.now()): H1StageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  if (s.error) return 'ERROR';
  const run = s.state.run;
  if (!run) return 'WAITING';
  const age = h1RunAgeMs(s, now);
  if (age == null || age > H1_STALE_MS) return 'STALE';
  return run.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
}

export function getH1Decision(symbol: string): H1Decision | undefined {
  return snapshot.state?.instruments.find((i) => i.symbol === symbol);
}
