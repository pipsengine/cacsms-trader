import type { VisionChart, VisionDetail, VisionState, VisionTf } from '../types';

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

export const fetchVisionState = () => request<VisionState>('/vision/state');

export const fetchVisionDetail = (symbol: string) => request<VisionDetail>(`/vision/detail?symbol=${encodeURIComponent(symbol)}`);

export const fetchVisionChart = (symbol: string, timeframe: VisionTf, bars: number) =>
  request<VisionChart>(`/vision/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&bars=${bars}`);

export const runVision = (symbol?: string) =>
  request<{ ok: boolean; analysed: number; failed: number; state: VisionState }>('/vision/run', {
    method: 'POST',
    body: JSON.stringify(symbol ? { symbol } : {}),
  });
