import type { EconPolicy, EconSnapshot } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/mt5-bridge${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`Economic intelligence ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchEconomicSnapshot(): Promise<EconSnapshot> {
  return request('/economic/snapshot');
}

export function saveEconomicPolicy(patch: Partial<EconPolicy>): Promise<{ ok: boolean; policy: EconPolicy }> {
  return request('/economic/policy', { method: 'POST', body: JSON.stringify(patch) });
}

export function refreshEconomicCalendar(): Promise<{ ok: boolean; message: string }> {
  return request('/economic/refresh', { method: 'POST', body: '{}' });
}

export function requestEconomicRevalidation(symbol: string): Promise<{ ok: boolean; message: string }> {
  return request('/economic/revalidate', { method: 'POST', body: JSON.stringify({ symbol }) });
}
