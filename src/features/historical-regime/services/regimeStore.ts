import { useSyncExternalStore } from 'react';
import type { RegimePair, RegimeStageStatus, RegimeState } from '../types';
import { explainBridgeError } from '../../../services/bridgeError';
import { fetchRegimeState, runRegime } from './regimeClient';

/** Server-side orchestrator cadence. The browser only polls persisted output. */
export const REGIME_INTERVAL_MS = 60_000;
const REGIME_OBSERVE_POLL_MS = 5_000;

export type RegimeStoreSnapshot = {
  state: RegimeState | null;
  loading: boolean;
  running: boolean;
  error: string;
  lastFetchAt: number | null;
  lastRunLatencyMs: number | null;
};

let snapshot: RegimeStoreSnapshot = {
  state: null,
  loading: true,
  running: false,
  error: '',
  lastFetchAt: null,
  lastRunLatencyMs: null,
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<RegimeStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeRegime(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getRegimeSnapshot = () => snapshot;

export function useRegimeStore(): RegimeStoreSnapshot {
  return useSyncExternalStore(subscribeRegime, getRegimeSnapshot, getRegimeSnapshot);
}

async function loadState() {
  try {
    const state = await fetchRegimeState();
    set({ state, loading: false, error: state.ok ? '' : state.message || 'Regime state unavailable', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: explainBridgeError(e, 'Regime state unavailable') });
  }
}

export async function runRegimeNow() {
  if (snapshot.running) return;
  set({ running: true });
  const started = performance.now();
  try {
    const state = await runRegime();
    set({
      state,
      loading: false,
      running: false,
      error: state.ok ? '' : state.message || 'Regime run blocked',
      lastFetchAt: Date.now(),
      lastRunLatencyMs: Math.round(performance.now() - started),
    });
  } catch (e) {
    set({ running: false, loading: false, error: e instanceof Error ? e.message : 'Regime run failed' });
  }
}

/** Re-read the persisted state only; never triggers an engine run. */
export const refreshRegime = () => loadState();

/** Ref-counted observation only: opening a page never starts or sustains the trading engine. */
export function startRegimeStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void loadState();
    timer = setInterval(() => void loadState(), REGIME_OBSERVE_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function getPairRegime(symbol: string): RegimePair | undefined {
  return snapshot.state?.pairs.find((p) => p.symbol === symbol);
}

export function regimeRunAgeMs(s: RegimeStoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function regimeStageStatus(s: RegimeStoreSnapshot = snapshot, now = Date.now()): RegimeStageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  const run = s.state.run;
  if (!run) return s.running ? 'RUNNING' : s.error ? 'ERROR' : 'WAITING';
  if (run.status === 'BLOCKED') return 'BLOCKED';
  const age = regimeRunAgeMs(s, now);
  if (age == null || age > 3 * REGIME_INTERVAL_MS) return s.error ? 'ERROR' : 'STALE';
  if (run.status === 'WARMING_UP') return 'WARMING UP';
  if (s.running) return 'RUNNING';
  return 'HEALTHY';
}
