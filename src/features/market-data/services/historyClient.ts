const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

export type HistoryStatusCode =
  | 'READY'
  | 'SYNCING'
  | 'STALE'
  | 'WARMING_UP'
  | 'MISSING_HISTORY'
  | 'VALIDATION_FAILED'
  | 'PROVIDER_OFFLINE';

export type HistoryJobState = 'QUEUED' | 'RUNNING' | 'VALIDATING' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'STALE' | 'BLOCKED';

export type HistoryIssue = { severity: 'INFO' | 'WARNING' | 'ERROR'; code: string; message: string; sample?: string[] };

export type HistorySeries = {
  symbol: string;
  timeframe: string;
  status: HistoryStatusCode;
  reason?: string | null;
  count: number;
  earliestTs?: number | null;
  latestTs?: number | null;
  earliest?: string | null;
  latest?: string | null;
  providerLatestTs?: number | null;
  requiredDepth: number;
  minRequired: number;
  providerDepth?: number | null;
  providerExhausted?: boolean;
  completeness?: number | null;
  quality?: number | null;
  integrityErrors?: number;
  missingBars?: number;
  gaps: Array<[number, number, number]>;
  providerGaps?: Array<[number, number, number]>;
  issues: HistoryIssue[];
  source?: string | null;
  sourceNote?: string | null;
  lastSyncAt?: string | null;
  lastSuccessAt?: string | null;
  lastValidatedAt?: string | null;
  lastRepairAt?: string | null;
  lastError?: string | null;
  freshnessSec?: number | null;
  depthPct?: number;
};

export type HistoryJob = {
  id: number;
  type: 'BOOTSTRAP' | 'INCREMENTAL' | 'REPAIR' | 'VALIDATE';
  symbol: string;
  timeframe: string;
  trigger: string;
  priority: number;
  state: HistoryJobState;
  attempts: number;
  maxAttempts: number;
  fetched: number;
  inserted: number;
  revised: number;
  checkpointTs?: number | null;
  message?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  nextAttemptAt?: string | null;
};

export type HistoryEvent = {
  id: number;
  at: string;
  kind: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  symbol?: string | null;
  timeframe?: string | null;
  jobId?: number | null;
  message: string;
  detail?: Record<string, unknown> | null;
};

export type HistoryInstrument = {
  symbol: string;
  status: HistoryStatusCode;
  ready: boolean;
  reason: string;
  series: Record<string, HistoryStatusCode>;
};

export type HistoryStatus = {
  ok: boolean;
  message?: string;
  provider: {
    connected: boolean;
    message?: string;
    server?: string | null;
    login?: string | null;
    pingMs?: number;
    feedStale: boolean;
    serverOffsetSec: number | null;
    offsetSource: string | null;
    serverNow: string | null;
    lastTickServer: string | null;
    marketOpen: boolean;
  };
  scheduler: {
    running: boolean;
    startedAt: string | null;
    lastCycleAt: string | null;
    cycleMs: number | null;
    intervalSec: number;
    workerAlive: boolean;
    recovering: boolean;
    errors: number;
    lastError: string | null;
    closures: number;
  };
  config: {
    timeframes: string[];
    core: string[];
    execution: string[];
    executionEnabled: boolean;
    spec: Record<string, { depth: number; min: number }>;
    completenessReady: number;
  };
  series: HistorySeries[];
  instruments: HistoryInstrument[];
  queue: {
    counts: Partial<Record<HistoryJobState, number>>;
    open: number;
    current: (Pick<HistoryJob, 'id' | 'type' | 'symbol' | 'timeframe'> & { state: string; runningSec: number }) | null;
    next: HistoryJob[];
  };
  summary: {
    series: number;
    ready: number;
    instrumentsReady: number;
    candles: number;
    quality: number | null;
    completeness: number | null;
  };
};

/** `ts` is broker server time (MT5 rates epoch), not UTC. */
export type HistoryCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spread: number | null;
  source: string;
  ingestedAt: string | null;
  revisedAt: string | null;
};

/** Format a broker-server epoch as wall-clock server time (no local timezone shift). */
export function serverTime(ts?: number | null, withTime = true): string {
  if (ts == null) return '—';
  const iso = new Date(ts * 1000).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

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

export const fetchHistoryStatus = () => request<HistoryStatus>('/history/status');

export const fetchHistoryEvents = (after: number, limit = 200) =>
  request<{ ok: boolean; events: HistoryEvent[] }>(`/history/events?after=${after}&limit=${limit}`).then((r) => r.events || []);

export const fetchHistorySeries = (symbol: string, timeframe: string) =>
  request<{ ok: boolean; series: HistorySeries | null; jobs: HistoryJob[]; candles: HistoryCandle[] }>(
    `/history/series?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
  );

type Target = { symbol?: string; timeframe?: string };

export const requestHistorySync = (t: Target = {}) =>
  request<{ ok: boolean; queued: number; message: string }>('/history/sync', { method: 'POST', body: JSON.stringify(t) });

export const requestHistoryRepair = (t: Target = {}) =>
  request<{ ok: boolean; queued: number; message: string }>('/history/repair', { method: 'POST', body: JSON.stringify(t) });

export const requestHistoryValidate = (t: Target = {}) =>
  request<{ ok: boolean; validated: number; results: Array<{ status: HistoryStatusCode }> }>('/history/validate', {
    method: 'POST',
    body: JSON.stringify(t),
  });

export const setHistoryExecutionTimeframes = (enabled: boolean) =>
  request<{ ok: boolean; executionEnabled: boolean }>('/history/config', {
    method: 'POST',
    body: JSON.stringify({ executionTimeframes: enabled }),
  });
