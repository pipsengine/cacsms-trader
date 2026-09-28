/** Browser client for the SQLite-backed app world state (via MT5 bridge). */

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

export type AppEvent = {
  id?: number;
  ts?: string;
  severity?: string;
  source?: string;
  message: string;
};

export type AppStatePayload = {
  ok?: boolean;
  settings?: Record<string, string>;
  instruments?: unknown[];
  strengths?: unknown[];
  positions?: unknown[];
  events?: AppEvent[];
  message?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`App DB unreachable (${res.status}). Start npm run mt5:bridge`);
  }
}

export async function loadAppState(): Promise<AppStatePayload> {
  try {
    return await request<AppStatePayload>('/app/state');
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'load failed', instruments: [], positions: [], strengths: [], events: [], settings: {} };
  }
}

export async function saveAppState(body: {
  settings?: Record<string, string | number | boolean>;
  instruments?: unknown[];
  strengths?: unknown[];
  positions?: unknown[];
  events?: AppEvent[];
}): Promise<{ ok: boolean; message: string }> {
  try {
    return await request('/app/state', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'save failed' };
  }
}
