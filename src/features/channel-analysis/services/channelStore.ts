import { useSyncExternalStore } from 'react';
import { explainBridgeError } from '../../../services/bridgeError';
import type { ChannelAnalysisSnapshot, ChannelTimeframe } from '../types';
import { fetchChannelLive, fetchChannelSnapshot, requestChannelReanalyse, type ChannelLiveQuote } from './channelClient';
import { TIMEFRAMES } from '../format';

/** Structure is read on this cadence. Price, position and the open candle are read every second. */
export const CHANNEL_POLL_MS = 15_000;
export const CHANNEL_LIVE_MS = 1_000;
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
let liveTimer: ReturnType<typeof setInterval> | null = null;
let starts = 0;
let seq = 0;
let liveSeq = 0;
let liveBusy = false;
let lastLive: ChannelLiveQuote | null = null;

function applyLive(data: ChannelAnalysisSnapshot, live: ChannelLiveQuote): ChannelAnalysisSnapshot {
  if (!data.selected || data.selected.instrument !== live.instrument || live.price == null) return data;
  const channels = { ...data.selected.channels };
  for (const tf of TIMEFRAMES) {
    const bar = live.bars?.[tf];
    const view = live.views?.[tf];
    const current = channels[tf];
    if (!current || (!bar && !view)) continue;
    const ch = { ...current };
    if (bar) {
      const candles = ch.candles.slice();
      const last = candles[candles.length - 1];
      const candle = { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, complete: false as const };
      if (!last || last.time < bar.time) candles.push(candle);
      else if (last.time === bar.time) candles[candles.length - 1] = candle;
      ch.candles = candles;
      if (bar.line) {
        const lines = ch.lines.filter((l) => l.time !== bar.line!.time);
        lines.push(bar.line);
        ch.lines = lines;
      }
    }
    if (view) ch.live = view;
    channels[tf] = ch;
  }
  return {
    ...data,
    selected: {
      ...data.selected,
      channels,
      price: live.price,
      priceSource: 'LIVE',
      liveAt: live.at,
      freshnessSeconds: live.ageSec,
    },
  };
}

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
    const painted = lastLive && lastLive.instrument === instrument && lastLive.at >= (data.generatedAt ?? 0) ? applyLive(data, lastLive) : data;
    set({ data: painted, loading: false, error: '', lastFetchAt: Date.now() });
    void loadLive();
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
  lastLive = null;
  set({ instrument, data: keep, loading: true, error: '', notice: '' });
  void load();
}

async function loadLive() {
  if (liveBusy || !snapshot.data?.selected) return;
  const ticket = ++liveSeq;
  const instrument = snapshot.instrument;
  liveBusy = true;
  try {
    const live = await fetchChannelLive(instrument);
    if (ticket !== liveSeq || instrument !== snapshot.instrument || !live.ok || !snapshot.data?.selected) return;
    lastLive = live;
    set({ data: applyLive(snapshot.data, live), lastFetchAt: Date.now() });
  } catch {
    /* a missed tick must not replace the last good structure read */
  } finally {
    if (ticket === liveSeq) liveBusy = false;
  }
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
    liveTimer = setInterval(() => void loadLive(), CHANNEL_LIVE_MS);
  }
  return () => {
    starts = Math.max(0, starts - 1);
    if (starts === 0) {
      if (timer) clearInterval(timer);
      if (liveTimer) clearInterval(liveTimer);
      timer = null;
      liveTimer = null;
      liveBusy = false;
    }
  };
}
