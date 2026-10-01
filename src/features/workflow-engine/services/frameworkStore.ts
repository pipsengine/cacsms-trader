import type { FrameworkHypothesis, FrameworkResponse } from './frameworkClient';
import { fetchFramework } from './frameworkClient';

export const FRAMEWORK_POLL_MS = 15_000;
export const FRAMEWORK_TERMINAL = new Set(['EXPIRED', 'INVALIDATED', 'COMPLETED']);

type FrameworkStoreSnapshot = {
  data: FrameworkResponse | null;
  loading: boolean;
  error: string;
  lastFetchAt: number | null;
};

let snapshot: FrameworkStoreSnapshot = { data: null, loading: true, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function set(patch: Partial<FrameworkStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeFramework(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getFrameworkSnapshot = () => snapshot;

async function load() {
  try {
    const data = await fetchFramework();
    set({ data, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : 'Framework state unavailable' });
  }
}

/** Ref-counted polling of `/opportunity/framework` (all instruments). */
export function startFrameworkStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), FRAMEWORK_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const LIFECYCLE_RANK: Record<string, number> = {
  AUTHORIZED: 90,
  EXECUTING: 88,
  OPEN: 86,
  READY_FOR_RISK: 84,
  TRIGGER_REACHED: 70,
  CONFIRMING: 65,
  WAITING: 40,
  WATCHING: 30,
  BLOCKED: 10,
};

/** Best active PRODUCTION hypothesis for an instrument (Opportunity Framework lane). */
export function bestProductionHypothesis(symbol: string): FrameworkHypothesis | null {
  const rows = (snapshot.data?.framework?.hypotheses ?? []).filter(
    (h) => h.symbol === symbol && h.mode === 'PRODUCTION' && !FRAMEWORK_TERMINAL.has(h.lifecycle),
  );
  if (!rows.length) return null;
  return [...rows].sort(
    (a, b) =>
      (LIFECYCLE_RANK[b.lifecycle] ?? 0) - (LIFECYCLE_RANK[a.lifecycle] ?? 0) ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  )[0];
}

export function frameworkStageCard(h: FrameworkHypothesis, stageId: number): { status: string; detail: string } | null {
  const card = h.stages[String(stageId)];
  if (!card) return null;
  return { status: card.status, detail: card.detail };
}
