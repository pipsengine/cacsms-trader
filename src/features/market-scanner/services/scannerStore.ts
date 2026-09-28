import { useSyncExternalStore } from 'react';
import type { ScannerInstrument, ScannerStateResponse } from '../types';
import { explainBridgeError } from '../../../services/bridgeError';
import { fetchScannerState, runScanner, saveScannerConfig } from './scannerClient';

/** The bridge re-ranks autonomously; the UI only reads persisted Stage 4 state. */
export const SCANNER_POLL_MS = 15_000;
/** The bridge sweeps at least every 10 minutes; beyond this the engine is not running. */
export const SCANNER_STALE_MS = 15 * 60_000;

export type ScannerStoreSnapshot = {
  state: ScannerStateResponse | null;
  loading: boolean;
  running: boolean;
  error: string;
  lastFetchAt: number | null;
};

export type ScannerStageStatus = 'WAITING' | 'HEALTHY' | 'DEGRADED' | 'STALE' | 'ERROR';

let snapshot: ScannerStoreSnapshot = { state: null, loading: true, running: false, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<ScannerStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeScanner(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getScannerSnapshot = () => snapshot;

export function useScannerStore(): ScannerStoreSnapshot {
  return useSyncExternalStore(subscribeScanner, getScannerSnapshot, getScannerSnapshot);
}

async function load() {
  try {
    const state = await fetchScannerState();
    set({ state, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: explainBridgeError(e, 'Scanner state unavailable') });
  }
}

export async function runScannerNow() {
  if (snapshot.running) return;
  set({ running: true });
  try {
    const r = await runScanner();
    set({ state: r.state, running: false, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ running: false, error: e instanceof Error ? e.message : 'Scanner run failed' });
  }
}

/** Persist operator thresholds on the bridge; it validates them and re-ranks immediately. */
export async function applyScannerConfig(overrides: Record<string, number | boolean>): Promise<string | null> {
  set({ running: true });
  try {
    const r = await saveScannerConfig(overrides);
    set({ state: r.state, running: false, error: '', lastFetchAt: Date.now() });
    return null;
  } catch (e) {
    set({ running: false });
    return e instanceof Error ? e.message : 'Configuration rejected';
  }
}

export function refreshScanner() {
  return load();
}

/** Ref-counted polling of the persisted Stage 4 state. */
export function startScannerStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), SCANNER_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function scannerRunAgeMs(s: ScannerStoreSnapshot = snapshot, now = Date.now()): number | null {
  const at = s.state?.run?.runAt ? Date.parse(s.state.run.runAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function scannerStageStatus(s: ScannerStoreSnapshot = snapshot, now = Date.now()): ScannerStageStatus {
  if (!s.state) return s.error ? 'ERROR' : 'WAITING';
  if (s.error) return 'ERROR';
  const run = s.state.run;
  if (!run) return 'WAITING';
  const age = scannerRunAgeMs(s, now);
  if (age == null || age > SCANNER_STALE_MS) return 'STALE';
  return run.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
}

export function getScannerInstrument(symbol: string): ScannerInstrument | undefined {
  return snapshot.state?.instruments.find((i) => i.symbol === symbol);
}
