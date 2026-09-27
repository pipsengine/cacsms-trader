import { useSyncExternalStore } from 'react';
import type { RiskConfig, RiskStateResponse } from '../types';
import { approveRisk, fetchRiskState, runRisk, saveRiskConfig } from './riskClient';

/** Stage 8 qualifies and authorizes on the bridge; the UI only reads persisted state and submits audited config changes. */
export const RISK_POLL_MS = 10_000;
/** The bridge re-evaluates at least every 5 minutes; beyond this the engine is not running. */
export const RISK_STALE_MS = 10 * 60_000;

export type RiskStoreSnapshot = {
  state: RiskStateResponse | null;
  loading: boolean;
  running: boolean;
  saving: boolean;
  error: string;
  lastFetchAt: number | null;
};

export type RiskStageStatus = 'WAITING' | 'HEALTHY' | 'DEGRADED' | 'STALE' | 'ERROR';

let snapshot: RiskStoreSnapshot = { state: null, loading: true, running: false, saving: false, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<RiskStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeRisk(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getRiskSnapshot = () => snapshot;

export function useRiskStore(): RiskStoreSnapshot {
  return useSyncExternalStore(subscribeRisk, getRiskSnapshot, getRiskSnapshot);
}

async function load() {
  try {
    const state = await fetchRiskState();
    set({ state, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : 'Opportunities & Risk state unavailable' });
  }
}

export async function runRiskNow() {
  if (snapshot.running) return;
  set({ running: true });
  try {
    const r = await runRisk();
    set({ state: r.state, running: false, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ running: false, error: e instanceof Error ? e.message : 'Opportunities & Risk run failed' });
  }
}

/** Throws on validation failure so the form can show the bridge's exact reason. */
export async function saveRiskConfigNow(changes: RiskConfig, reason: string) {
  set({ saving: true });
  try {
    const r = await saveRiskConfig(changes, reason);
    set({ state: r.state, saving: false, error: '', lastFetchAt: Date.now() });
    return r;
  } catch (e) {
    set({ saving: false });
    throw e;
  }
}

export async function approveRiskNow(setupKey: string, accountId: string) {
  const r = await approveRisk(setupKey, accountId);
  set({ state: r.state, lastFetchAt: Date.now() });
  return r;
}

/** Ref-counted polling of the persisted Stage 8 state. */
export function startRiskStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), RISK_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function riskRunAgeMs(s: RiskStoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function riskStageStatus(s: RiskStoreSnapshot = snapshot, now = Date.now()): RiskStageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  if (s.error) return 'ERROR';
  const run = s.state.run;
  if (!run) return 'WAITING';
  const age = riskRunAgeMs(s, now);
  if (age == null || age > RISK_STALE_MS) return 'STALE';
  return run.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
}
