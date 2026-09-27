import type { RegimeSnapshot, RegimeState } from '../types';

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
  if (!res.ok && !(body && typeof body === 'object' && 'assets' in body)) {
    throw new Error(body?.message || `MT5 bridge error ${res.status}`);
  }
  return body;
}

export function fetchRegimeState(): Promise<RegimeState> {
  return request<RegimeState>('/regime/state');
}

export function runRegime(): Promise<RegimeState> {
  return request<RegimeState>('/regime/run', { method: 'POST', body: '{}' });
}

export async function fetchRegimeHistory(asset: string, limit = 260): Promise<RegimeSnapshot[]> {
  const r = await request<{ ok: boolean; history: RegimeSnapshot[]; message?: string }>(
    `/regime/history?asset=${encodeURIComponent(asset)}&limit=${limit}`,
  );
  if (!r.ok) throw new Error(r.message || 'Regime history unavailable');
  return r.history || [];
}
