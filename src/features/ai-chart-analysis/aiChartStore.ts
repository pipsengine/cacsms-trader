import { useSyncExternalStore } from 'react';

import { explainBridgeError } from '../../services/bridgeError';

import { fetchAiAnalysis, fetchAiChartLatest } from './aiChartClient';

import type { AiChartAnalysisPayload, AnalysisMode, StripTf } from './types';



/** Subscribe to autonomous background analysis (page is a viewer, not the driver). */

export const AI_CHART_VIEW_POLL_MS = 3_000;



const STORAGE_KEY = 'cacsms.ai-chart.symbol';



export type AiChartStoreSnapshot = {

  symbol: string;

  mode: AnalysisMode;

  primaryTf: StripTf;

  lookback: number;

  data: AiChartAnalysisPayload | null;

  loading: boolean;

  error: string;

  lastFetchAt: number | null;

  autonomous: boolean;

  persistMaterialChanges: boolean;

  lastPersistKey: string | null;

};



function initialSymbol(): string {

  try {

    return localStorage.getItem(STORAGE_KEY) || 'XAUUSD';

  } catch {

    return 'XAUUSD';

  }

}



function persistKey(payload: AiChartAnalysisPayload): string {

  return [

    payload.status,

    payload.direction,

    payload.p1State,

    payload.p2State,

    payload.opportunity,

    JSON.stringify(payload.lastClosedCandle ?? {}),

    (payload as { analysisId?: string }).analysisId,

  ].join('|');

}



function lastCandleKey(payload: AiChartAnalysisPayload): string {

  if (!payload.ok) return '';

  const candles = payload.chart?.candles;

  if (!candles?.length) return '';

  const c = candles[candles.length - 1]!;

  return `${c.time}|${c.open}|${c.high}|${c.low}|${c.close}`;

}



function materialChange(prev: AiChartAnalysisPayload | null, next: AiChartAnalysisPayload): boolean {

  if (!prev?.ok) return true;

  return persistKey(prev) !== persistKey(next);

}



let snapshot: AiChartStoreSnapshot = {

  symbol: initialSymbol(),

  mode: 'FULL_ANALYSIS',

  primaryTf: 'H1',

  lookback: 500,

  data: null,

  loading: true,

  error: '',

  lastFetchAt: null,

  autonomous: true,

  persistMaterialChanges: true,

  lastPersistKey: null,

};



const listeners = new Set<() => void>();

let timer: ReturnType<typeof setInterval> | null = null;

let starts = 0;

let seq = 0;

let inFlight = false;



function emit() {

  listeners.forEach((l) => l());

}



function set(patch: Partial<AiChartStoreSnapshot>) {

  snapshot = { ...snapshot, ...patch };

  emit();

}



/** Read autonomous snapshot; optional on-demand recompute for mode/TF/lookback overrides. */

async function load(options?: { persist?: boolean; recompute?: boolean }) {

  if (inFlight) return;

  inFlight = true;

  const mySeq = ++seq;

  const recompute = options?.recompute ?? false;

  if (recompute) set({ loading: true, error: '' });



  const prev = snapshot.data;

  let persist = options?.persist ?? false;



  try {

    const useOnDemand =

      recompute ||

      snapshot.mode !== 'FULL_ANALYSIS' ||

      snapshot.primaryTf !== 'H1' ||

      snapshot.lookback !== 500;



    const res = useOnDemand

      ? await fetchAiAnalysis({

          symbol: snapshot.symbol,

          mode: snapshot.mode,

          primaryTf: snapshot.primaryTf,

          lookback: snapshot.lookback,

          persist: false,

          force: true,

        })

      : await fetchAiChartLatest(snapshot.symbol);



    if (mySeq !== seq) return;



    if (!res.ok) {

      if (!recompute && !prev?.ok) {

        set({ data: res, loading: false, error: res.message || res.code || 'Waiting for autonomous analysis', lastFetchAt: Date.now() });

      } else if (prev?.ok) {

        set({ loading: false, error: res.message || res.code || 'Analysis unavailable', lastFetchAt: Date.now() });

      } else {

        set({ data: res, loading: false, error: res.message || res.code || 'Analysis failed', lastFetchAt: Date.now() });

      }

      return;

    }



    if (!recompute && prev?.ok && persistKey(prev) === persistKey(res)) {

      if (lastCandleKey(prev) === lastCandleKey(res)) {

        set({ loading: false, error: '', lastFetchAt: Date.now() });

        return;

      }

      set({ data: res, loading: false, error: '', lastFetchAt: Date.now() });

      return;

    }



    if (snapshot.persistMaterialChanges && materialChange(prev?.ok ? prev : null, res)) {

      persist = true;

    }

    if (options?.persist) persist = true;



    let data = res;

    if (persist) {

      const stored = await fetchAiAnalysis({

        symbol: snapshot.symbol,

        mode: snapshot.mode,

        primaryTf: snapshot.primaryTf,

        lookback: snapshot.lookback,

        persist: true,

        force: true,

      });

      if (mySeq === seq && stored.ok) data = stored;

    }



    set({

      data,

      loading: false,

      error: '',

      lastFetchAt: Date.now(),

      lastPersistKey: persist && data.ok ? persistKey(data) : snapshot.lastPersistKey,

    });

  } catch (e) {

    if (mySeq !== seq) return;

    set({

      loading: false,

      error: explainBridgeError(e, 'AI chart analysis unavailable'),

      lastFetchAt: Date.now(),

    });

  } finally {

    inFlight = false;

  }

}



export function getAiChartSnapshot(): AiChartStoreSnapshot {

  return snapshot;

}



export function subscribeAiChart(listener: () => void) {

  listeners.add(listener);

  return () => listeners.delete(listener);

}



export function setAiChartSymbol(symbol: string) {

  const s = symbol.toUpperCase();

  if (s === snapshot.symbol) return;

  try {

    localStorage.setItem(STORAGE_KEY, s);

  } catch {

    /* ignore */

  }

  set({ symbol: s, data: null, loading: true, error: '' });

  void load({ recompute: false });

}



export function setAiChartMode(mode: AnalysisMode) {

  if (mode === snapshot.mode) return;

  set({ mode, loading: true });

  void load({ recompute: true });

}



export function setAiChartPrimaryTf(primaryTf: StripTf) {

  if (primaryTf === snapshot.primaryTf) return;

  set({ primaryTf, loading: true });

  void load({ recompute: true });

}



export function setAiChartLookback(lookback: number) {

  const n = Math.max(80, Math.min(800, lookback));

  if (n === snapshot.lookback) return;

  set({ lookback: n, loading: true });

  void load({ recompute: true });

}



export function setAiChartAutonomous(on: boolean) {

  set({ autonomous: on });

}



export function setAiChartPersistMaterial(on: boolean) {

  set({ persistMaterialChanges: on });

}



export function refreshAiChartAnalysis(manualPersist = false) {

  void load({ recompute: true, persist: manualPersist });

}



/** Ref-counted view polling — reads autonomous output, does not drive analysis. */

export function startAiChartStore(): () => void {

  starts += 1;

  if (starts === 1) {

    void load({ recompute: false });

    timer = setInterval(() => {

      if (snapshot.autonomous) void load({ recompute: false });

    }, AI_CHART_VIEW_POLL_MS);

  }

  return () => {

    starts = Math.max(0, starts - 1);

    if (starts === 0 && timer) {

      clearInterval(timer);

      timer = null;

    }

  };

}



export function useAiChartStore(): AiChartStoreSnapshot {

  return useSyncExternalStore(subscribeAiChart, getAiChartSnapshot, getAiChartSnapshot);

}


