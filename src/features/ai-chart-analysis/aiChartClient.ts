import type { AiChartAnalysisPayload, AnalysisMode, LibraryResponse, StripTf } from './types';

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as { message?: string; ok?: boolean };
  if (!res.ok) {
    const msg = body.message || res.statusText;
    if (res.status === 404 && /unknown path/i.test(msg)) {
      throw new Error(
        'MT5 bridge is running an older build without AI Chart Analysis. Stop the terminal running npm run dev (Ctrl+C), then run npm run dev again — or use System Control → Restart bridge after dev has been updated once.',
      );
    }
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export type AiChartHeartbeat = {
  ok: boolean;
  symbol?: string;
  message?: string;
  lastClosedCandle?: Record<string, number>;
  generatedAtMs?: number;
};

export function fetchAiChartLatest(symbol: string): Promise<AiChartAnalysisPayload> {
  const q = new URLSearchParams({ symbol });
  return get(`/ai/chart-analysis/latest?${q}`);
}

export function fetchAiChartHeartbeat(symbol: string): Promise<AiChartHeartbeat> {
  const q = new URLSearchParams({ symbol });
  return get(`/ai/chart-analysis/heartbeat?${q}`);
}

export function fetchAiAnalysis(params: {
  symbol: string;
  mode?: AnalysisMode;
  primaryTf?: StripTf;
  lookback?: number;
  persist?: boolean;
  force?: boolean;
}): Promise<AiChartAnalysisPayload> {
  const q = new URLSearchParams({
    symbol: params.symbol,
    mode: params.mode || 'FULL_ANALYSIS',
    primaryTf: params.primaryTf || 'H1',
    lookback: String(params.lookback ?? 80),
    persist: params.persist ? '1' : '0',
    force: params.force ? '1' : '0',
  });
  return get(`/ai/chart-analysis/analyse?${q}`);
}

export function fetchAiLibrary(filters: Record<string, string | number | undefined>): Promise<LibraryResponse> {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v));
  });
  return get(`/ai/chart-analysis/library?${q}`);
}

export function fetchAiAnalysisDetail(id: string): Promise<AiChartAnalysisPayload> {
  return get(`/ai/chart-analysis/detail?id=${encodeURIComponent(id)}`);
}

export async function fetchChannelInstruments(): Promise<string[]> {
  const res = await get<{ ok: boolean; instruments: { symbol: string }[] }>('/channels/instruments');
  return (res.instruments || []).map((i) => i.symbol).sort();
}
