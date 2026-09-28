const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

export type LearningFilters = {
  accountId?: string;
  accountClass?: string;
  symbol?: string;
  setup?: string;
  relationship?: string;
  regime?: string;
  session?: string;
  timeframe?: string;
  modelVersion?: string;
  from?: string;
  to?: string;
};

export type StageTrace = { stage: number; stored: boolean; summary: unknown };

export type LearningTrade = {
  key: string;
  kind: string;
  executionId?: string;
  setupKey?: string;
  accountId?: string;
  accountClass?: string;
  currency?: string;
  symbol?: string;
  direction?: string;
  setup?: string;
  relationship?: string;
  regime?: string | null;
  session?: string | null;
  alignment?: string | null;
  channelPosition?: number | null;
  nested?: string | null;
  primaryTrend?: string | null;
  tradable?: string | null;
  confidence?: number | null;
  rewardRisk?: number | null;
  realizedPnl?: number | null;
  rMultiple?: number | null;
  slippagePoints?: number | null;
  exitReason?: string;
  outcome?: string;
  process?: string;
  openedAt?: string | null;
  closedAt?: string | null;
  decision?: string;
  reason?: string;
  evidence?: Record<string, unknown>;
  stages?: StageTrace[];
  path?: { label: string; detail: string; changePct?: number };
};

export type SliceRow = {
  label: string;
  sample: number;
  reliable: boolean;
  note: string;
  winRate: number | null;
  averageR: number | null;
  evidenceKeys: string[];
};

export type LearningState = {
  ok: boolean;
  health: {
    status: string;
    message: string;
    runAt: string | null;
    durationMs: number | null;
    trigger: string | null;
    closedTrades: number;
    decisions: number;
    filteredTrades: number;
    sampleSufficient: boolean;
    requiredTrades: number;
    sliceSize: number;
    lifecycle: string;
    modelVersion: string;
    candidateVersion: string | null;
    validation: string;
    governance: string;
    nextCycle: string;
    productionUnchanged: boolean;
  };
  performance: {
    trades: number;
    wins: number;
    losses: number;
    flats: number;
    currency: string | null;
    currencies: string[];
    netPnl: number | null;
    netNote: string;
    winRate: number | null;
    profitFactor: number | null;
    profitFactorNote: string;
    averageR: number | null;
    expectancy: number | null;
    expectancyNote: string;
    maxDrawdown: number | null;
    peakEquity: number | null;
    currentEquity: number | null;
    sharpe: number | null;
    sharpeNote: string;
    avgSlippage: number | null;
    slippageSample: number;
    curve: { n: number; equity: number }[];
    drawdown: { n: number; drawdown: number }[];
    processNote: string;
  };
  analytics: Record<string, SliceRow[]>;
  insights: { code: string; title: string; detail: string; sample: number; required: number; evidenceKeys: string[] }[];
  proposals: {
    key: string;
    parameter: string;
    lifecycle: string;
    direction: string;
    reason: string;
    sample: number;
    required: number;
    productionValue: number | null;
    candidateValue: number | null;
    applied: boolean;
    evidence: { evidenceKeys?: string[]; validation?: { status?: string; detail?: string } };
    updatedAt: string | null;
  }[];
  versions: { id: number; label: string; kind: string; comparison: string | null; note: string | null; createdAt: string | null }[];
  trades: LearningTrade[];
  decisions: LearningTrade[];
  filters: {
    accounts: string[];
    classes: string[];
    symbols: string[];
    setups: string[];
    relationships: string[];
    regimes: string[];
    sessions: string[];
    timeframes: string[];
    modelVersions: string[];
  };
};

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  let body: T & { ok?: boolean; message?: string };
  try {
    body = (await res.json()) as T & { ok?: boolean; message?: string };
  } catch {
    throw new Error('MT5 bridge unreachable. Stage 10 keeps running on the bridge when this page is closed.');
  }
  if (!res.ok || body?.ok === false) throw new Error(body?.message || `Stage 10 error ${res.status}`);
  return body;
}

export function postLearning(path: string, body: Record<string, unknown>) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => {
    const payload = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || payload.ok === false) throw new Error(payload.message || `Stage 10 error ${res.status}`);
    return payload;
  });
}

export function fetchLearningState(filters: LearningFilters = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
  const q = qs.toString();
  return request<LearningState>(`/learning/state${q ? `?${q}` : ''}`);
}
