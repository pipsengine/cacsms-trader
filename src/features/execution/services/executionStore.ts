import { useSyncExternalStore } from 'react';
import type { ExecutionStateResponse } from '../types';
import { fetchExecutionState, requestExit, requestReconcile, resolveFinding, setExecutionControl, type ControlPatch } from './executionClient';

/** Stage 9 runs on the bridge's central engine; the page only reads its persisted state and sends audited operator commands. */
export const EXECUTION_POLL_MS = 5_000;
/** The engine cycles every 2 s and persists its meta at least every 10 s; beyond this it is not running. */
export const EXECUTION_STALE_MS = 60_000;

export type ExecutionStoreSnapshot = {
  state: ExecutionStateResponse | null;
  loading: boolean;
  busy: boolean;
  error: string;
  lastFetchAt: number | null;
};

export type ExecutionStageStatus = 'WAITING' | 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED' | 'STALE' | 'ERROR';

let snapshot: ExecutionStoreSnapshot = { state: null, loading: true, busy: false, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<ExecutionStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeExecution(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getExecutionSnapshot = () => snapshot;

export function useExecutionStore(): ExecutionStoreSnapshot {
  return useSyncExternalStore(subscribeExecution, getExecutionSnapshot, getExecutionSnapshot);
}

export async function loadExecution() {
  try {
    const state = await fetchExecutionState();
    set({ state, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : 'Execution & Positions state unavailable' });
  }
}

async function command<T>(fn: () => Promise<T>): Promise<T> {
  set({ busy: true });
  try {
    const r = await fn();
    await loadExecution();
    return r;
  } finally {
    set({ busy: false });
  }
}

/** Throws with the bridge's exact reason so the caller can show it. */
export const setControlNow = (patch: ControlPatch, reason: string) => command(() => setExecutionControl(patch, reason));
export const requestExitNow = (executionId: string, reason: string) => command(() => requestExit(executionId, reason));
export const resolveFindingNow = (id: number, resolution: string, note: string) => command(() => resolveFinding(id, resolution, note));
export const reconcileNow = () => command(() => requestReconcile());

/** Ref-counted polling of the persisted Stage 9 state. */
export function startExecutionStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void loadExecution();
    timer = setInterval(() => void loadExecution(), EXECUTION_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function executionRunAgeMs(s: ExecutionStoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function executionStageStatus(s: ExecutionStoreSnapshot = snapshot, now = Date.now()): ExecutionStageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  if (s.error) return 'ERROR';
  const run = s.state.run;
  if (!run || !run.runAt) return 'WAITING';
  const age = executionRunAgeMs(s, now);
  if (age == null || age > EXECUTION_STALE_MS) return 'STALE';
  if (run.status === 'DISCONNECTED') return 'DISCONNECTED';
  return run.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
}
