import type { ChannelAnalysisSnapshot, ChannelTimeframe, ChannelUniverseItem } from '../types';

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

export const fetchChannelSnapshot = (instrument: string) =>
  request<ChannelAnalysisSnapshot>(`/channels/snapshot?instrument=${encodeURIComponent(instrument)}`);

export const fetchChannelInstruments = () => request<{ ok: boolean; instruments: ChannelUniverseItem[] }>('/channels/instruments');

/** Diagnostic only: queues a forced recalculation on the bridge engine; the result arrives through the normal read path. */
export const requestChannelReanalyse = (instrument: string, timeframes?: ChannelTimeframe[]) =>
  request<{ ok: boolean; eventId: number | null; message: string }>('/channels/reanalyse', {
    method: 'POST',
    body: JSON.stringify({ instrument, timeframes, reason: 'operator diagnostic from Channel Analysis' }),
  });
