import type { ScannerDetail, ScannerStateResponse } from '../types';

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

type RunResult = { ok: boolean; ran: boolean; promoted: number; changes: number; state: ScannerStateResponse };

export const fetchScannerState = () => request<ScannerStateResponse>('/scanner/state');

export const fetchScannerDetail = (symbol: string) => request<ScannerDetail>(`/scanner/detail?symbol=${encodeURIComponent(symbol)}`);

export const runScanner = () => request<RunResult>('/scanner/run', { method: 'POST', body: '{}' });

export const saveScannerConfig = (overrides: Record<string, number | boolean>) =>
  request<RunResult>('/scanner/config', { method: 'POST', body: JSON.stringify({ overrides }) });
