import { useSyncExternalStore } from 'react';
import { explainBridgeError } from '../../../services/bridgeError';
import type { ChannelAnalysisSnapshot, ChannelTimeframe } from '../types';
import { fetchChannelSnapshot, requestChannelReanalyse } from './channelClient';

/** The bridge engine recalculates on candle closes on its own; the page only reads the persisted state. */
export const CHANNEL_POLL_MS = 15_000;
const STORAGE_KEY = 'cacsms.channels.instrument';

export type ChannelStoreSnapshot = {
  instrument: string;
  data: ChannelAnalysisSnapshot | null;
  loading: boolean;
  error: string;
  lastFetchAt: number | null;
  reanalysing: boolean;
  notice: string;
};

function initialInstrument(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'EURUSD';
  } catch {
    return 'EURUSD';
  }
}

let snapshot: ChannelStoreSnapshot = {
  instrument: initialInstrument(),
  data: null,
  loading: true,
  error: '',
  lastFetchAt: null,
  reanalysing: false,
  notice: '',
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;
let seq = 0;

function set(patch: Partial<ChannelStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

export function useChannelStore(): ChannelStoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

async function load() {
  const ticket = ++seq;
  const instrument = snapshot.instrument;
  try {
    const data = await fetchChannelSnapshot(instrument);
    // A slower response for an earlier request or another instrument must never overwrite a newer view.
    if (ticket !== seq || instrument !== snapshot.instrument) return;
    const prevRun = snapshot.data?.selected?.instrument === instrument ? snapshot.data.selected.runId : null;
    if (prevRun != null && data.selected && data.selected.runId < prevRun) return;
    set({ data, loading: false, error: '', lastFetchAt: Date.now() });
  } catch (e) {
    if (ticket !== seq) return;
    set({ loading: false, error: explainBridgeError(e, 'Channel Analysis unavailable') });
  }
}

export function refreshChannels() {
  return load();
}

export function selectChannelInstrument(instrument: string) {
  if (instrument === snapshot.instrument) return;
  try {
    localStorage.setItem(STORAGE_KEY, instrument);
  } catch {
    /* storage unavailable — selection still applies for this session */
  }
  const keep = snapshot.data ? { ...snapshot.data, selected: null, events: [] } : null;
  set({ instrument, data: keep, loading: true, error: '', notice: '' });
  void load();
}

export async function reanalyseChannels(timeframes?: ChannelTimeframe[]) {
  if (snapshot.reanalysing) return;
  set({ reanalysing: true, notice: '' });
  try {
    const r = await requestChannelReanalyse(snapshot.instrument, timeframes);
    set({ reanalysing: false, notice: r.message || 'Re-analysis queued' });
    setTimeout(() => void load(), 2500);
  } catch (e) {
    set({ reanalysing: false, notice: explainBridgeError(e, 'Re-analysis request failed') });
  }
}

/** Ref-counted polling so the page and any embedded consumer share one request loop. */
export function startChannelStore(): () => void {
  starts += 1;
  if (starts === 1) {
    void load();
    timer = setInterval(() => void load(), CHANNEL_POLL_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
