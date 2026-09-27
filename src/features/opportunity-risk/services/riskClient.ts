import type { Authorization, ConfigAudit, RiskConfig, RiskDetail, RiskStateResponse } from '../types';

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

type WithState = { ok: boolean; state: RiskStateResponse };

export type SaveConfigResult = WithState & { changed: string[]; critical?: boolean; hash: string };

export const fetchRiskState = () => request<RiskStateResponse>('/risk/state');

export const fetchRiskDetail = (setupKey: string) => request<RiskDetail>(`/risk/detail?setupKey=${encodeURIComponent(setupKey)}`);

export const fetchAuthorizations = (status?: string, limit = 60) =>
  request<{ ok: boolean; authorizations: Authorization[] }>(`/risk/authorizations?limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`);

export const fetchRiskConfig = () => request<{ ok: boolean; config: RiskConfig; overrides: RiskConfig; audit: ConfigAudit[] }>('/risk/config');

export const runRisk = () => request<WithState>('/risk/run', { method: 'POST', body: '{}' });

export const saveRiskConfig = (changes: RiskConfig, reason: string, actor = 'operator') =>
  request<SaveConfigResult>('/risk/config', { method: 'POST', body: JSON.stringify({ changes, reason, actor }) });

export const approveRisk = (setupKey: string, accountId: string, actor = 'operator') =>
  request<WithState & { message: string }>('/risk/approve', { method: 'POST', body: JSON.stringify({ setupKey, accountId, actor }) });
