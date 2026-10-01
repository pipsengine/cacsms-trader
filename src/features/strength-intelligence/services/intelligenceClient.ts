import type { IntelligenceSnapshot } from '../types';

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

export async function fetchStrengthIntelligence(params: {
  period: string;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<IntelligenceSnapshot> {
  const qs = new URLSearchParams({
    period: params.period,
    limit: String(params.limit ?? 80),
    offset: String(params.offset ?? 0),
  });
  if (params.search) qs.set('search', params.search);
  const res = await fetch(`${BASE}/intelligence/strength?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  let body: IntelligenceSnapshot & { message?: string };
  try {
    body = (await res.json()) as IntelligenceSnapshot & { message?: string };
  } catch {
    throw new Error(`MT5 bridge unreachable (${res.status}). Start it with npm run mt5:bridge`);
  }
  if (!res.ok && !body.matrix) {
    throw new Error(body.message || `Strength intelligence unavailable (${res.status})`);
  }
  return body;
}

