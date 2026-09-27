import type { DirectionDetail, DirectionState, Stage7Handoff } from '../types';

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

type RunResult = { ok: boolean; ran: boolean; changed: number; ready: number; state: DirectionState };

export const fetchDirectionState = () => request<DirectionState>('/direction/state');

export const fetchDirectionDetail = (symbol: string) => request<DirectionDetail>(`/direction/detail?symbol=${encodeURIComponent(symbol)}`);

export const fetchStage7Handoff = () => request<{ ok: boolean; candidates: Stage7Handoff[] }>('/direction/handoff');

export const runDirection = () => request<RunResult>('/direction/run', { method: 'POST', body: '{}' });
