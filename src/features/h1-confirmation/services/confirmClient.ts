import type { H1Chart, H1ConfirmState, H1Detail, Stage8Handoff } from '../types';

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

type RunResult = { ok: boolean; ran: boolean; changed: number; confirmed: number; state: H1ConfirmState };

export const fetchH1State = () => request<H1ConfirmState>('/h1/state');

export const fetchH1Detail = (symbol: string) => request<H1Detail>(`/h1/detail?symbol=${encodeURIComponent(symbol)}`);

export const fetchH1Chart = (symbol: string, bars = 180) => request<H1Chart>(`/h1/chart?symbol=${encodeURIComponent(symbol)}&bars=${bars}`);

export const fetchStage8Handoff = () => request<{ ok: boolean; candidates: Stage8Handoff[] }>('/h1/handoff');

export const runH1 = () => request<RunResult>('/h1/run', { method: 'POST', body: '{}' });
