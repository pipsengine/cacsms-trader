import type { ChannelAnalysisSnapshot, ChannelTimeframe, ChannelUniverseItem, LiveView } from '../types';

export interface ChannelLiveBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  complete: false;
  line?: { time: number; upper: number; lower: number; mid: number };
}

export interface ChannelLiveQuote {
  ok: boolean;
  instrument: string;
  price: number;
  at: number;
  ageSec: number;
  bars: Partial<Record<ChannelTimeframe, ChannelLiveBar>>;
  views: Partial<Record<ChannelTimeframe, LiveView>>;
  message?: string;
}

export interface BreakoutState {
  ok?: boolean;
  health?: string;
  lastScan?: number | null;
  instrumentsScanned?: number;
  universe?: number;
  activeCount?: number;
  counts?: Record<string, number>;
  candidates?: BreakoutCandidate[];
  history?: BreakoutCandidate[];
  message?: string;
}

export interface BreakoutCandidate {
  candidateId: string;
  symbol: string;
  titLevel: string;
  opportunityFamily?: string;
  channelRole?: string;
  confirmationTimeframe?: string;
  parent?: { timeframe?: string; direction?: string; channelId?: string };
  channel?: {
    id?: string; timeframe?: string; role?: string; direction?: string; status?: string;
    confidence?: number; position?: number | null; upper?: number; mid?: number; lower?: number;
  };
  breakout?: {
    relevantBoundary?: string; expectedDirection?: string; boundaryPrice?: number; currentPrice?: number | null;
    distancePrice?: number | null; distanceATR?: number | null; state?: string; engineState?: string;
    detectedAt?: number | null; confirmedAt?: number | null; breakPrice?: number | null; quality?: number | null;
    penetrationAtr?: number | null;
  };
  retest?: {
    state?: string | null; zoneLow?: number | null; zoneHigh?: number | null;
    startedAt?: number | null; confirmedAt?: number | null; failureReason?: string | null;
  };
  structure?: { bos?: { label?: string } | null; choch?: { label?: string } | null };
  p1?: { state?: string | null; reason?: string | null };
  p2?: { state?: string | null; reason?: string | null };
  freshness?: { state?: string; updatedAt?: number };
  removedReason?: string;
  removedAt?: number;
}

export interface BreakoutChart {
  candles?: { time: number; open: number; high: number; low: number; close: number }[];
  lines?: { time: number; upper: number; lower: number; mid: number }[];
  retest?: { zoneLow?: number | null; zoneHigh?: number | null };
  boundary?: string;
  breakPrice?: number | null;
}

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let body: T & { ok?: boolean; message?: string };
  try {
    body = (await res.json()) as T & { ok?: boolean; message?: string };
  } catch {
    throw new Error(`MT5 bridge unreachable (${res.status}). Start it with npm run mt5:bridge`);
  }
  if (!res.ok) throw new Error(body?.message || `MT5 bridge error ${res.status}`);
  return body;
}

const slice = <T extends { time: number }>(rows: T[], from: number, count: number) => {
  const i = rows.findIndex((r) => r.time === from);
  return i < 0 ? [] : rows.slice(i, i + count);
};

/** Resolves the bridge's shared D1 chart series (one copy for D1/YTD/HY) back into per-context candles and lines. */
export function expandSharedSeries(data: ChannelAnalysisSnapshot): ChannelAnalysisSnapshot {
  const sel = data.selected;
  if (!sel) return data;
  const { sharedCandles = {}, ...rest } = sel;
  const channels = { ...sel.channels };
  for (const tf of Object.keys(channels) as ChannelTimeframe[]) {
    const ch = channels[tf];
    if (ch?.candlesRef) {
      const { candlesRef, ...plain } = ch;
      channels[tf] = { ...plain, candles: slice(sharedCandles[candlesRef.source] ?? [], candlesRef.from, candlesRef.count) };
    }
  }
  for (const tf of Object.keys(channels) as ChannelTimeframe[]) {
    const ch = channels[tf];
    if (ch?.linesRef) {
      const { linesRef, ...plain } = ch;
      channels[tf] = { ...plain, lines: slice(channels[linesRef.timeframe]?.lines ?? [], linesRef.from, linesRef.count) };
    }
  }
  return { ...data, selected: { ...rest, channels } };
}

export const fetchChannelSnapshot = (instrument: string) =>
  request<ChannelAnalysisSnapshot>(`/channels/snapshot?instrument=${encodeURIComponent(instrument)}`).then(expandSharedSeries);

export const fetchChannelLive = (instrument: string) =>
  request<ChannelLiveQuote>(`/channels/live?instrument=${encodeURIComponent(instrument)}`);

export const fetchChannelInstruments = () => request<{ ok: boolean; instruments: ChannelUniverseItem[] }>('/channels/instruments');

/** Diagnostic only: queues a forced recalculation on the bridge engine; the result arrives through the normal read path. */
export const requestChannelReanalyse = (instrument: string, timeframes?: ChannelTimeframe[]) =>
  request<{ ok: boolean; eventId: number | null; message: string }>('/channels/reanalyse', {
    method: 'POST',
    body: JSON.stringify({ instrument, timeframes, reason: 'operator diagnostic from Channel Analysis' }),
  });

export const fetchBreakoutState = () => request<BreakoutState>('/channel-breakouts/state');

export const fetchBreakoutCandidate = (id: string) =>
  request<{ ok: boolean; candidate: BreakoutCandidate; chart: BreakoutChart | null }>(
    `/channel-breakouts/candidate?id=${encodeURIComponent(id)}`,
  );
