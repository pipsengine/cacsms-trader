import { useSyncExternalStore } from 'react';
import { explainBridgeError } from '../../../services/bridgeError';
import { fetchLearningState, type LearningFilters, type LearningState } from './learningClient';

export const LEARNING_POLL_MS = 10_000;

export type LearningSnapshot = {
  state: LearningState | null;
  filters: LearningFilters;
  loading: boolean;
  error: string;
  lastFetchAt: number | null;
};

let snapshot: LearningSnapshot = { state: null, filters: {}, loading: true, error: '', lastFetchAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;
let seq = 0;

function emit(patch: Partial<LearningSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeLearning(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLearningSnapshot = () => snapshot;

export function useLearningStore(): LearningSnapshot {
  return useSyncExternalStore(subscribeLearning, getLearningSnapshot, getLearningSnapshot);
}

async function load(filters = snapshot.filters) {
  const token = ++seq;
  try {
    const state = await fetchLearningState(filters);
    if (token !== seq) return;
    emit({ state, filters, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    if (token !== seq) return;
    emit({ loading: false, error: explainBridgeError(e, 'Stage 10 state unavailable') });
  }
}

export function setLearningFilters(filters: LearningFilters) {
  emit({ filters, loading: true });
  void load(filters);
}

export function reloadLearning() {
  void load();
}

export function startLearningStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), LEARNING_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
