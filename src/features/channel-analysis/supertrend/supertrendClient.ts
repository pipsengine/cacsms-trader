import type { SupertrendSettings, SupertrendSnapshot, SupertrendTimeframe } from './types';

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 25_000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal: init?.signal ?? controller.signal,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  }).finally(() => window.clearTimeout(timer));
  let body: T & { ok?: boolean; message?: string };
  try {
    body = (await res.json()) as T & { ok?: boolean; message?: string };
  } catch {
    throw new Error(`MT5 bridge unreachable (${res.status}). Start it with npm run mt5:bridge`);
  }
  if (!res.ok) throw new Error(body?.message || `MT5 bridge error ${res.status}`);
  return body;
}

export function fetchSupertrend(symbol: string) {
  return request<SupertrendSnapshot>(`/api/intelligence/supertrend/${encodeURIComponent(symbol)}`, { timeoutMs: 25_000 });
}

export function fetchSupertrendCard(symbol: string, timeframe: SupertrendTimeframe) {
  return request<{ ok: boolean; symbol: string; timeframe: SupertrendTimeframe; card: SupertrendSnapshot['cards'][SupertrendTimeframe]; settings: SupertrendSettings }>(
    `/api/intelligence/supertrend/${encodeURIComponent(symbol)}/${timeframe}`,
  );
}

export function updateSupertrendConfig(body: { atrMultiplier: number; atrPeriod: number; expectedRevision: number }) {
  return request<{ ok: boolean; settings: SupertrendSettings; conflict?: boolean; message?: string }>('/api/intelligence/supertrend/config', {
    method: 'PUT',
    body: JSON.stringify({ ...body, actor: 'operator' }),
  });
}

export function resetSupertrendConfig(expectedRevision: number) {
  return request<{ ok: boolean; settings: SupertrendSettings; conflict?: boolean; message?: string }>('/api/intelligence/supertrend/config/reset', {
    method: 'POST',
    body: JSON.stringify({ expectedRevision, actor: 'operator' }),
  });
}

