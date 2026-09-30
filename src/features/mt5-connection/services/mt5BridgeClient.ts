/** Browser client for the localhost MT5 bridge (proxied via Vite). */

export type BridgeAccountInfo = {
  login: string;
  name: string;
  server: string;
  company: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  profit: number;
  tradeAllowed: boolean;
  tradeExpert: boolean;
};

export type BridgePosition = {
  id: string;
  accountId?: string;
  accountLogin: string;
  cacsmsTradeId: string;
  mt5OrderId: string;
  mt5DealId?: string;
  mt5PositionId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  entry: number;
  current: number;
  sl?: number | null;
  tp?: number | null;
  pnl: number;
  currency: string;
  status: 'OPEN';
  openedAt: string;
};

export type BridgeHealth = {
  ok: boolean;
  bridge: string;
  message?: string;
  terminalConnected?: boolean;
  login?: string | null;
  server?: string | null;
  currency?: string | null;
  equity?: number | null;
  pingLastMs?: number | null;
  terminalName?: string | null;
  terminalPath?: string | null;
};

export type BridgeSyncResult = {
  ok: boolean;
  message: string;
  bridge?: string;
  account?: BridgeAccountInfo;
  positions?: BridgePosition[];
  ticks?: BridgeTick[];
  latencyMs?: number;
};

export type BridgeTick = {
  symbol: string;
  bid: number;
  ask: number;
  last?: number;
  volume?: number;
  time?: string;
};

const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  let body: T & { message?: string };
  try {
    body = (await res.json()) as T & { message?: string };
  } catch {
    throw new Error(`MT5 bridge unreachable (${res.status}). Start it with npm run mt5:bridge`);
  }
  if (!res.ok && body && typeof body === 'object' && 'ok' in body && (body as { ok: boolean }).ok === false) {
    return body;
  }
  if (!res.ok) {
    throw new Error(body?.message || `MT5 bridge error ${res.status}`);
  }
  return body;
}

export async function bridgeHealth(): Promise<BridgeHealth> {
  try {
    return await request<BridgeHealth>('/health');
  } catch (e) {
    return {
      ok: false,
      bridge: 'DISCONNECTED',
      message: e instanceof Error ? e.message : 'Bridge offline',
      terminalConnected: false,
    };
  }
}

export async function bridgeSync(input: {
  accountId: string;
  login: string;
  server?: string;
  password?: string;
  name?: string;
  broker?: string;
  firm?: string;
  secretRef?: string;
  terminalInstance?: string;
  tradingMode?: string;
  accountClass?: string;
  riskProfile?: string;
  maxConcurrentTrades?: number;
  assignedSymbols?: string[];
  propRules?: unknown;
}): Promise<BridgeSyncResult> {
  try {
    return await request<BridgeSyncResult>('/sync', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Bridge sync failed',
      bridge: 'DISCONNECTED',
    };
  }
}

export async function bridgePulse(input: {
  accountId: string;
  login: string;
  server?: string;
  symbols?: string[];
}): Promise<BridgeSyncResult> {
  try {
    return await request<BridgeSyncResult>('/pulse', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Bridge pulse failed',
      bridge: 'DISCONNECTED',
    };
  }
}

export async function bridgeTest(input: {
  login: string;
  server: string;
  password?: string;
  broker?: string;
}): Promise<BridgeSyncResult> {
  try {
    return await request<BridgeSyncResult>('/test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Bridge test failed',
    };
  }
}

export async function bridgeStoreSecret(input: {
  accountId: string;
  login: string;
  server: string;
  password: string;
}): Promise<{ ok: boolean; message: string; secretRef?: string }> {
  try {
    return await request('/secrets', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Unable to store secret on bridge',
    };
  }
}

export async function bridgeListAccounts(): Promise<{
  ok: boolean;
  accounts: Array<Record<string, unknown>>;
  positions: BridgePosition[];
  message?: string;
}> {
  try {
    return await request('/accounts');
  } catch (e) {
    return {
      ok: false,
      accounts: [],
      positions: [],
      message: e instanceof Error ? e.message : 'Unable to load accounts from DB',
    };
  }
}

export async function bridgeUpsertAccount(account: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  id?: string;
}> {
  try {
    return await request('/accounts', {
      method: 'POST',
      body: JSON.stringify(account),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Unable to persist account',
    };
  }
}

export async function bridgeDbHealth(): Promise<{
  ok: boolean;
  database?: string;
  accounts?: number;
  instruments?: number;
  openPositions?: number;
  message?: string;
}> {
  try {
    return await request('/db/health');
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'DB health failed' };
  }
}

export type BridgeEnrichRow = {
  symbol: string;
  ok?: boolean;
  bid?: number;
  ask?: number;
  spread?: number;
  change?: number;
  d1?: string;
  h8?: string;
  h1?: string;
  score?: number;
  state?: string;
  confidence?: number;
  strengthDiff?: number;
  channelPos?: number;
  time?: string;
  bars?: Record<string, number>;
  message?: string;
};

export async function bridgeEnrich(symbols: string[]): Promise<{
  ok: boolean;
  message?: string;
  bridge?: string;
  instruments: BridgeEnrichRow[];
  latencyMs?: number;
  at?: string;
}> {
  try {
    return await request('/market/enrich', {
      method: 'POST',
      body: JSON.stringify({ symbols }),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Enrich failed',
      instruments: [],
    };
  }
}

export type BridgeBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type AutonomyDecision = {
  id: number;
  stage: number;
  symbol: string | null;
  accountId: string | null;
  trigger: string | null;
  decision: string;
  reason: string | null;
  blockerCode: string | null;
  blocker: string | null;
  nextAction: string | null;
  createdAt: string | null;
};

export type OpportunityHypothesis = {
  instrument?: string;
  opportunityFamily?: string;
  TiTLevel?: string | null;
  direction?: string;
  status?: string;
  actionable?: boolean;
  blocker?: string;
  parentChannelPosition?: number | null;
  location?: { price?: number | null; zoneLow?: number | null; zoneHigh?: number | null; distance?: number | null; distanceAtr?: number | null; inside?: boolean | null };
  expectedRetracementZone?: { reasons?: string[] };
  p1?: { state?: string; reason?: string; riskPct?: number };
  p2?: { state?: string; reason?: string; riskPct?: number };
};

export type AutonomyState = {
  ok: boolean;
  message?: string;
  jobs: Record<string, number>;
  orchestrator?: {
    status?: string;
    message?: string;
    heartbeatAt?: string;
    connected?: boolean;
    analysisPaused?: boolean;
    cycles?: number;
    errors?: number;
    threadAlive?: boolean;
    recoveredJobs?: number;
  };
  learning?: {
    status?: string;
    runAt?: string | null;
    durationMs?: number | null;
    tradesEvaluated?: number;
    rejectionsEvaluated?: number;
    recommendations?: number;
    summary?: { message?: string; autoApplied?: boolean; productionUnchanged?: boolean };
  } | null;
  opportunity?: {
    run?: { status?: string; message?: string };
    summary?: {
      scanned?: number; universe?: number; normal?: number; tit?: number; L1?: number; L2?: number; L3?: number; L4?: number; xau?: string;
      detected?: number;
      funnel?: { scanned?: number; hypotheses?: number; watching?: number; confirming?: number; erzActive?: number; p1ZoneReached?: number; p1Ready?: number; p2Ready?: number; waitRetest?: number; stage8Authorized?: number; activeCampaigns?: number; actionable?: number };
      blockers?: Record<string, number>;
      legs?: { p1?: Record<string, number>; p2?: Record<string, number> };
      production?: { operatorPositionLimit?: number; xauReservePct?: number };
    };
    instruments?: { symbol: string; hypotheses?: OpportunityHypothesis[]; execution?: Record<string, { direction?: string; status?: string; phase?: string; position?: number | null; confidence?: number; touchCount?: number; upper?: number; lower?: number; mid?: number }> }[];
    qualified?: {
      instrument: string;
      direction?: string;
      opportunityFamily?: string;
      TiTLevel?: string | null;
      parentTimeframe?: string;
      childTimeframe?: string;
      executionTimeframe?: string;
      p1?: { state?: string; riskPct?: number };
      p2?: { state?: string; riskPct?: number };
      remainingRisk?: number;
      reasons?: string[];
    }[];
  } | null;
  decisions?: AutonomyDecision[];
  events?: { id: number; type: string; stage: number | null; symbol: string | null; severity: string; createdAt: string | null }[];
};

export async function bridgeAutonomyState(): Promise<AutonomyState> {
  try {
    const body = await request<AutonomyState>('/autonomy/state');
    return { ...body, jobs: body.jobs ?? {}, ok: body.ok !== false };
  } catch (e) {
    return { ok: false, jobs: {}, message: e instanceof Error ? e.message : 'Autonomy state unavailable' };
  }
}

export async function bridgeAutonomyRun(input: { reason: string; stage?: number; symbol?: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const body = await request<{ ok: boolean; message?: string }>('/autonomy/run', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ok: body.ok !== false, message: body.message || 'Diagnostic reprocess queued' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Diagnostic reprocess failed' };
  }
}

export async function bridgeBars(
  symbol: string,
  timeframe: string,
  count = 120,
): Promise<{ ok: boolean; message?: string; bars: BridgeBar[]; count?: number }> {
  try {
    return await request('/bars', {
      method: 'POST',
      body: JSON.stringify({ symbol, timeframe, count }),
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Bars failed', bars: [] };
  }
}
