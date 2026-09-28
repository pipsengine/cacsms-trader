import { useSyncExternalStore } from 'react';
import type { VisionInstrument, VisionState } from '../types';
import { explainBridgeError } from '../../../services/bridgeError';
import { fetchVisionState, runVision } from './visionClient';

/** The bridge re-analyses autonomously; the UI only reads persisted Stage 5 state. */
export const VISION_POLL_MS = 15_000;
/** The bridge sweeps every instrument at least every 15 minutes; beyond this the engine is not running. */
export const VISION_STALE_MS = 20 * 60_000;

export type VisionStoreSnapshot = {
  state: VisionState | null;
  loading: boolean;
  running: boolean;
  error: string;
  lastFetchAt: number | null;
};

export type VisionStageStatus = 'WAITING' | 'HEALTHY' | 'DEGRADED' | 'STALE' | 'ERROR';

let snapshot: VisionStoreSnapshot = { state: null, loading: true, running: false, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<VisionStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeVision(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getVisionSnapshot = () => snapshot;

export function useVisionStore(): VisionStoreSnapshot {
  return useSyncExternalStore(subscribeVision, getVisionSnapshot, getVisionSnapshot);
}

async function load() {
  try {
    const state = await fetchVisionState();
    set({ state, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: explainBridgeError(e, 'Vision state unavailable') });
  }
}

export async function runVisionNow(symbol?: string) {
  if (snapshot.running) return;
  set({ running: true });
  try {
    const r = await runVision(symbol);
    set({ state: r.state, running: false, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ running: false, error: e instanceof Error ? e.message : 'Vision run failed' });
  }
}

export function refreshVision() {
  return load();
}

/** Ref-counted polling of the persisted Stage 5 state. */
export function startVisionStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), VISION_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function visionRunAgeMs(s: VisionStoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function visionStageStatus(s: VisionStoreSnapshot = snapshot, now = Date.now()): VisionStageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  if (s.error) return 'ERROR';
  const run = s.state.run;
  if (!run) return 'WAITING';
  const age = visionRunAgeMs(s, now);
  if (age == null || age > VISION_STALE_MS) return 'STALE';
  return run.status === 'DEGRADED' ? 'DEGRADED' : 'HEALTHY';
}

export function getVisionInstrument(symbol: string): VisionInstrument | undefined {
  return snapshot.state?.instruments.find((i) => i.symbol === symbol);
}
