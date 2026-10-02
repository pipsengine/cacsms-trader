import { useSyncExternalStore } from 'react';
import { explainBridgeError } from '../../services/bridgeError';
import { fetchAiLibrary } from '../ai-chart-analysis/aiChartClient';
import type { LibraryRow } from '../ai-chart-analysis/types';

export const AI_LIBRARY_POLL_MS = 30_000;

export type AiLibraryFilters = {
  symbol: string;
  status: string;
  query: string;
};

export type AiLibrarySnapshot = {
  summary: Record<string, number>;
  rows: LibraryRow[];
  total: number;
  loading: boolean;
  error: string;
  filters: AiLibraryFilters;
  lastFetchAt: number | null;
};

let rawRows: LibraryRow[] = [];

let snapshot: AiLibrarySnapshot = {
  summary: {},
  rows: [],
  total: 0,
  loading: true,
  error: '',
  filters: { symbol: '', status: '', query: '' },
  lastFetchAt: null,
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;

function emit() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<AiLibrarySnapshot>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function filterRows(rows: LibraryRow[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.analysisId.toLowerCase().includes(needle) || r.symbol.toLowerCase().includes(needle));
}

async function load(soft = false) {
  if (!soft) set({ loading: true, error: '' });
  const { symbol, status, query } = snapshot.filters;
  try {
    const res = await fetchAiLibrary({
      symbol: symbol || undefined,
      status: status || undefined,
      limit: 100,
    });
    rawRows = res.rows;
    set({
      summary: res.summary,
      rows: filterRows(rawRows, query),
      total: res.total,
      loading: false,
      error: '',
      lastFetchAt: Date.now(),
    });
  } catch (e) {
    set({
      loading: false,
      error: explainBridgeError(e, 'Library unavailable'),
      rows: [],
      lastFetchAt: Date.now(),
    });
  }
}

export function getAiLibrarySnapshot() {
  return snapshot;
}

export function subscribeAiLibrary(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAiLibraryFilters(patch: Partial<AiLibraryFilters>) {
  const next = { ...snapshot.filters, ...patch };
  if (Object.keys(patch).length === 1 && 'query' in patch) {
    set({ filters: next, rows: filterRows(rawRows, next.query) });
    return;
  }
  set({ filters: next });
  void load(false);
}

export function refreshAiLibrary() {
  void load(false);
}

export function startAiLibraryStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load(false);
    timer = setInterval(() => void load(true), AI_LIBRARY_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useAiLibraryStore() {
  return useSyncExternalStore(subscribeAiLibrary, getAiLibrarySnapshot, getAiLibrarySnapshot);
}
