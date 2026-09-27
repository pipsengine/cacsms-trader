import type { ExecTrade, ExecutionConfig, ExecutionDetail, ExecutionStateResponse } from '../types';

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
  if (!res.ok || body?.ok === false) throw new Error(body?.message || `MT5 bridge error ${res.status}`);
  return body;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export type ControlPatch = { tradingEnabled?: boolean; executionEnabled?: boolean; emergencyStop?: boolean; analysisPaused?: boolean };

export const fetchExecutionState = () => request<ExecutionStateResponse>('/execution/state');

export const fetchExecutionDetail = (executionId: string) => request<ExecutionDetail>(`/execution/detail?executionId=${encodeURIComponent(executionId)}`);

export function fetchTrades(filter: { accountId?: string; symbol?: string; q?: string; days?: number; limit?: number } = {}) {
  const qs = new URLSearchParams();
  Object.entries(filter).forEach(([k, v]) => v != null && v !== '' && qs.set(k, String(v)));
  return request<{ ok: boolean; trades: ExecTrade[] }>(`/execution/trades?${qs.toString()}`);
}

/** Every control command is executed by the central engine on the bridge — the page never talks to MT5. */
export const setExecutionControl = (patch: ControlPatch, reason: string, actor = 'operator') =>
  post<{ ok: boolean; changed: string[]; tradingEnabled: boolean; state: ExecutionStateResponse }>('/execution/control', { ...patch, reason, actor });

export const requestExit = (executionId: string, reason: string, actor = 'operator') =>
  post<{ ok: boolean; message: string }>('/execution/close', { executionId, reason, actor });

export const resolveFinding = (id: number, resolution: string, note: string, actor = 'operator') =>
  post<{ ok: boolean; message: string }>('/execution/resolve', { id, resolution, note, actor });

export const requestReconcile = (actor = 'operator') => post<{ ok: boolean; message: string }>('/execution/reconcile', { actor });

export const saveExecutionConfig = (changes: ExecutionConfig, reason: string, actor = 'operator') =>
  post<{ ok: boolean; changed: string[] }>('/execution/config', { changes, reason, actor });
