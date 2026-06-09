import { listTerminalSnapshots, recordTerminalHeartbeat } from './mt5-heartbeat-store';
import { reconcileBridgeExecutionState } from './execution-bridge-store';
import { resolveTerminalOpenPositionCount } from './open-position-count';

export type LiveTerminalView = {
  terminalId: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  status: 'connected' | 'degraded' | 'disconnected';
  equity: number;
  balance: number;
  margin: number;
  freeMargin: number;
  openOrders: number;
  heartbeatAgeMs: number;
  lastTickTime: string | null;
  receivedAt: string | null;
};

export type LiveTerminalFeed = {
  bridgeOnline: boolean;
  connectedCount: number;
  degradedCount: number;
  disconnectedCount: number;
  totalEquity: number;
  totalBalance: number;
  totalOpenOrders: number;
  terminals: LiveTerminalView[];
  syncedAt: string;
};

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

function isTestTerminal(terminalId: unknown): boolean {
  return String(terminalId ?? '').startsWith('TEST-');
}

function normalizeTerminalStatus(value: unknown, heartbeatAgeMs: number): LiveTerminalView['status'] {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'connected' && heartbeatAgeMs <= 15_000) return 'connected';
  if (raw === 'degraded' || (raw === 'connected' && heartbeatAgeMs <= 30_000)) return 'degraded';
  if (heartbeatAgeMs <= 15_000) return 'connected';
  if (heartbeatAgeMs <= 30_000) return 'degraded';
  return 'disconnected';
}

function mapBridgeTerminalToHeartbeatPayload(terminal: Record<string, unknown>): Record<string, unknown> {
  return {
    terminalId: terminal.terminalId,
    computerId: terminal.computerId,
    computerName: terminal.computerName,
    accountNumber: terminal.accountNumber,
    brokerName: terminal.brokerName,
    serverName: terminal.serverName,
    accountType: terminal.accountType,
    enableExecution: terminal.enableExecution,
    accountTradeAllowed: terminal.accountTradeAllowed,
    terminalTradeAllowed: terminal.terminalTradeAllowed,
    balance: terminal.balance,
    equity: terminal.equity,
    margin: terminal.margin,
    freeMargin: terminal.freeMargin,
    openOrders: Math.max(Number(terminal.openPositions ?? 0), Number(terminal.openOrders ?? 0)),
    openPositions: Math.max(Number(terminal.openPositions ?? 0), Number(terminal.openOrders ?? 0)),
    connectionStatus: terminal.connectionStatus ?? terminal.status,
    lastTickTime: terminal.lastTickTime,
    terminalTime: terminal.terminalTime,
    mt5ServerTime: terminal.mt5ServerTime,
    nigeriaTime: terminal.nigeriaTime,
    latencyMs: terminal.latencyMs,
    heartbeatIntervalSeconds: terminal.heartbeatIntervalSeconds,
    sequence: terminal.sequence,
    version: terminal.version ?? terminal.eaVersion,
    sentAt: terminal.sentAt,
  };
}

function normalizeLiveTerminal(terminal: Record<string, unknown>): LiveTerminalView {
  const heartbeatAgeMs = Number(terminal.heartbeatAgeMs ?? 0);
  const status = normalizeTerminalStatus(terminal.status ?? terminal.connectionStatus, heartbeatAgeMs);
  return {
    terminalId: String(terminal.terminalId ?? ''),
    accountNumber: String(terminal.accountNumber ?? ''),
    brokerName: String(terminal.brokerName ?? 'Unknown broker'),
    serverName: String(terminal.serverName ?? ''),
    status,
    equity: Number(terminal.equity ?? 0),
    balance: Number(terminal.balance ?? terminal.equity ?? 0),
    margin: Number(terminal.margin ?? 0),
    freeMargin: Number(terminal.freeMargin ?? 0),
    openOrders: resolveTerminalOpenPositionCount({
      openPositions: Number(terminal.openPositions ?? 0),
      openOrders: Number(terminal.openOrders ?? terminal.open_trade_count ?? 0),
      margin: Number(terminal.margin ?? 0),
      equity: Number(terminal.equity ?? 0),
      balance: Number(terminal.balance ?? 0),
    }),
    heartbeatAgeMs,
    lastTickTime: terminal.lastTickTime ? String(terminal.lastTickTime) : null,
    receivedAt: terminal.receivedAt ? String(terminal.receivedAt) : null,
  };
}

function mergeTerminals(databaseTerminals: Array<Record<string, unknown>>, bridgeTerminals: Array<Record<string, unknown>>) {
  const merged = new Map<string, Record<string, unknown>>();
  databaseTerminals.forEach((terminal) => {
    const id = String(terminal.terminalId ?? '');
    if (id) merged.set(id, terminal);
  });
  bridgeTerminals.forEach((terminal) => {
    const id = String(terminal.terminalId ?? '');
    if (!id) return;
    const existing = merged.get(id);
    merged.set(id, existing ? { ...existing, ...terminal } : terminal);
  });
  return Array.from(merged.values());
}

async function fetchBridgeHealth(): Promise<{ online: boolean; connected: number; degraded: number; disconnected: number }> {
  try {
    const response = await fetch(`${bridgeUrl()}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { online: false, connected: 0, degraded: 0, disconnected: 0 };
    const payload = await response.json();
    return {
      online: Boolean(payload.ok),
      connected: Number(payload.connectedTerminalCount ?? 0),
      degraded: Number(payload.degradedTerminalCount ?? 0),
      disconnected: Number(payload.disconnectedTerminalCount ?? 0),
    };
  } catch {
    return { online: false, connected: 0, degraded: 0, disconnected: 0 };
  }
}

async function fetchBridgeTerminals(): Promise<Array<Record<string, unknown>>> {
  try {
    const response = await fetch(`${bridgeUrl()}/terminals`, {
      cache: 'no-store',
      headers: bridgeSecretHeader(),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    const terminals = Array.isArray(payload?.terminals) ? payload.terminals : [];
    return terminals.filter((terminal: Record<string, unknown>) => !isTestTerminal(terminal.terminalId));
  } catch {
    return [];
  }
}

export async function getLiveTerminalFeed(options?: { syncHeartbeats?: boolean }): Promise<LiveTerminalFeed> {
  const syncHeartbeats = options?.syncHeartbeats !== false;
  const [health, bridgeTerminals, databaseTerminals] = await Promise.all([
    fetchBridgeHealth(),
    fetchBridgeTerminals(),
    listTerminalSnapshots().catch(() => []),
  ]);

  if (syncHeartbeats && health.online && bridgeTerminals.length > 0) {
    await reconcileBridgeExecutionState().catch(() => null);
    await Promise.allSettled(
      bridgeTerminals.map((terminal) => recordTerminalHeartbeat(mapBridgeTerminalToHeartbeatPayload(terminal))),
    );
  }

  const merged = mergeTerminals(
    databaseTerminals.map((terminal) => ({ ...terminal })),
    bridgeTerminals,
  );

  const terminals = merged
    .map((terminal) => normalizeLiveTerminal(terminal))
    .filter((terminal) => terminal.terminalId && !isTestTerminal(terminal.terminalId))
    .sort((a, b) => a.heartbeatAgeMs - b.heartbeatAgeMs);

  const liveConnected = terminals.filter((terminal) => terminal.status === 'connected');
  const liveDegraded = terminals.filter((terminal) => terminal.status === 'degraded');
  const liveDisconnected = terminals.filter((terminal) => terminal.status === 'disconnected');

  const activeTerminals = terminals.filter((terminal) => terminal.status !== 'disconnected');
  const equitySource = activeTerminals.length > 0 ? activeTerminals : terminals;
  const totalEquity = equitySource.reduce((sum, terminal) => sum + terminal.equity, 0);
  const totalBalance = equitySource.reduce((sum, terminal) => sum + terminal.balance, 0);
  const totalOpenOrders = equitySource.reduce((sum, terminal) => sum + terminal.openOrders, 0);
  // openOrders field holds resolved position count after normalizeLiveTerminal

  return {
    bridgeOnline: health.online,
    connectedCount: health.online ? Math.max(health.connected, liveConnected.length) : liveConnected.length,
    degradedCount: health.online ? Math.max(health.degraded, liveDegraded.length) : liveDegraded.length,
    disconnectedCount: health.online ? Math.max(health.disconnected, liveDisconnected.length) : liveDisconnected.length,
    totalEquity,
    totalBalance,
    totalOpenOrders,
    terminals,
    syncedAt: new Date().toISOString(),
  };
}
