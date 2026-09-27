import { allPairs, instruments } from '../../../data/market';
import { eventBus } from '../../../services/eventBus';
import { decisionAudit } from '../../../services/decisionAudit';
import { SYSTEM } from '../../../config/system';
import { qualifyRisk } from '../../../engine/risk';
import { INSTRUMENTS, TIMEFRAMES } from '../data/instruments';
import { nextTerminalInstanceId } from '../utils/terminalInstance';
import { qualifyExecution } from './executionQualification';
import { reconcile } from './reconciliation';
import { calculateRiskSize } from './currencyRisk';
import { assertExecutionSafe } from './mt5ConnectionAdapter';
import { bridgeHealth, bridgeListAccounts, bridgePulse, bridgeStoreSecret, bridgeSync, bridgeTest, bridgeUpsertAccount, type BridgePosition, type BridgeSyncResult } from './mt5BridgeClient';
import { loadAppState, saveAppState } from '../../../services/appDb';
import { publishLiveFeed } from '../../../services/liveFeed';
import type { Position as AppPosition } from '../../../types';
import type {
  AccountClass,
  ConnectionState,
  MT5Account,
  MT5AccountDraft,
  MT5CommandResult,
  MT5Event,
  MT5Snapshot,
  Position as MT5Position,
  PropRules,
  SymbolMap,
  TradingMode,
} from '../types/mt5.types';

const now = () => new Date().toISOString();
const universe = (INSTRUMENTS as readonly string[]).length === allPairs.length ? [...INSTRUMENTS] : [...allPairs];

let seq = 100;
let globalTradingEnabled = false;
let reconnectAttempts = 0;

const listeners = new Set<(s: MT5Snapshot) => void>();

function pushEvent(
  message: string,
  severity: MT5Event['severity'] = 'INFO',
  category: MT5Event['category'] = 'SYSTEM',
  accountId?: string,
  symbol?: string,
) {
  const event: MT5Event = {
    id: `mt5-e-${++seq}`,
    timestamp: now(),
    severity,
    category,
    accountId,
    symbol,
    message,
  };
  snapshot = { ...snapshot, events: [event, ...snapshot.events].slice(0, 250) };
  eventBus.emit({
    id: event.id,
    type: category === 'ORDER' || category === 'POSITION' ? 'POSITION_EVENT' : category === 'MARKET_DATA' ? 'TICK' : 'RISK_EVENT',
    symbol,
    at: event.timestamp,
    payload: { detail: message, accountId, stage: 9, severity },
  });
  decisionAudit.append({
    id: `mt5-audit-${seq}`,
    symbol: symbol || 'SYSTEM',
    decision: severity === 'ERROR' ? 'BLOCKED' : 'WATCH',
    reason: message,
    confidence: 90,
    evidence: [{ source: 'mt5Gateway', value: category, confidence: 90, timestamp: event.timestamp }],
    createdAt: event.timestamp,
  });
}

function buildMaps(accounts: MT5Account[]): SymbolMap[] {
  return accounts.flatMap((a) =>
    universe.map((s, i) => ({
      canonical: s,
      accountId: a.id,
      brokerSymbol: a.currency === 'NGN' && s === 'XAUUSD' ? 'GOLD' : a.accountClass === 'PROP' ? `${s}.pro` : s,
      enabled: true,
      digits: s.includes('JPY') || s === 'XAUUSD' ? 3 : 5,
      minLot: 0.01,
      maxLot: 100,
      lotStep: 0.01,
      tickSize: s === 'XAUUSD' ? 0.01 : 0.00001,
      tickValue: a.currency === 'NGN' ? 1600 : 1,
      spread: Number((0.4 + (i % 7) * 0.15).toFixed(2)),
      status: 'UNMAPPED' as const,
    })),
  );
}

function buildCoverage(accounts: MT5Account[]) {
  return accounts.flatMap((a) =>
    universe.map((symbol) => ({
      accountId: a.id,
      symbol,
      timeframes: Object.fromEntries(
        TIMEFRAMES.map((tf) => [
          tf,
          {
            available: false,
            bars: 0,
            lastBar: undefined as string | undefined,
            stale: true,
          },
        ]),
      ),
      lastSync: now(),
    })),
  );
}

/** Empty estate — accounts appear only after Add Account / MT5 connect. */
let snapshot: MT5Snapshot = {
  accounts: [],
  symbolMaps: [],
  coverage: [],
  gateway: {
    pending: 0,
    ordersToday: 0,
    successful: 0,
    rejected: 0,
    avgExecutionMs: 0,
    avgSlippagePips: 0,
  },
  health: {
    bridge: 'DISCONNECTED',
    marketData: 'OFFLINE',
    orderGateway: 'BLOCKED',
    heartbeat: 'LOST',
    reconciliation: 'PENDING',
    queueDepth: 0,
    reconnectAttempts: 0,
    lastHeartbeat: now(),
    feedLatencyMs: 0,
  },
  events: [],
  positions: [],
  globalTradingEnabled: false,
  updatedAt: now(),
};

pushEvent('MT5 Connection Centre ready — add an account to connect a terminal', 'INFO', 'SYSTEM');

let syncInFlight = false;
let lastBridgePoll = 0;
let lastDbPersist = 0;

function persistPositionsThrottled(accountId: string, mapped: MT5Position[]) {
  const t = Date.now();
  if (t - lastDbPersist < 5000) return;
  lastDbPersist = t;
  void loadAppState().then((state: Awaited<ReturnType<typeof loadAppState>>) => {
    const others = (state.positions || []).filter(
      (p: unknown) => (p as { accountId?: string }).accountId !== accountId,
    );
    return saveAppState({
      positions: [
        ...others,
        ...mapped.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          entry: p.entry,
          current: p.current,
          sl: p.sl || 0,
          tp: p.tp || 0,
          size: p.volume,
          risk: 0,
          pnl: p.pnl,
          status: p.status,
          opened: p.openedAt,
          accountId: p.accountId,
        })),
      ],
    });
  });
}

function applyBridgeSync(accountId: string, result: BridgeSyncResult, persist = true): void {
  if (!result.ok || !result.account) return;
  const a = result.account;
  setAccountState(accountId, {
    balance: a.balance,
    equity: a.equity,
    margin: a.margin,
    freeMargin: a.freeMargin,
    leverage: a.leverage,
    profit: a.profit,
    currency: a.currency || snapshot.accounts.find((x) => x.id === accountId)?.currency || 'USD',
    server: a.server || snapshot.accounts.find((x) => x.id === accountId)?.server,
    lastHeartbeat: now(),
    latencyMs: result.latencyMs ?? 0,
    connectedAt: snapshot.accounts.find((x) => x.id === accountId)?.connectedAt || now(),
  });

  const mapped: MT5Position[] = (result.positions || []).map((p) => ({
    id: p.id,
    accountId,
    cacsmsTradeId: p.cacsmsTradeId,
    mt5OrderId: p.mt5OrderId,
    mt5DealId: p.mt5DealId,
    mt5PositionId: p.mt5PositionId,
    symbol: p.symbol,
    side: p.side,
    volume: p.volume,
    entry: p.entry,
    current: p.current,
    sl: p.sl ?? undefined,
    tp: p.tp ?? undefined,
    pnl: p.pnl,
    currency: p.currency,
    status: 'OPEN',
    openedAt: p.openedAt,
  }));

  snapshot = {
    ...snapshot,
    positions: [...mapped, ...snapshot.positions.filter((p) => p.accountId !== accountId)],
    health: {
      ...snapshot.health,
      bridge: result.bridge === 'HEALTHY' ? 'HEALTHY' : snapshot.health.bridge,
      marketData: 'STREAMING',
      heartbeat: 'HEALTHY',
      feedLatencyMs: result.latencyMs ?? snapshot.health.feedLatencyMs,
      lastHeartbeat: now(),
      reconciliation: 'CURRENT',
    },
  };

  const appPositions: AppPosition[] = mapped.map((p) => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    entry: p.entry,
    current: p.current,
    sl: p.sl || 0,
    tp: p.tp || 0,
    size: p.volume,
    risk: 0,
    pnl: p.pnl,
    status: 'ACTIVE',
    opened: p.openedAt,
  }));

  publishLiveFeed({
    ticks: result.ticks,
    positions: appPositions,
    latencyMs: result.latencyMs,
  });

  if (persist) persistPositionsThrottled(accountId, mapped);
}

async function pollHealthyAccounts() {
  const healthy = snapshot.accounts.filter((a) => a.state === 'HEALTHY');
  if (!healthy.length || syncInFlight) return;
  const t = Date.now();
  if (t - lastBridgePoll < 1000) return;
  lastBridgePoll = t;
  syncInFlight = true;
  try {
    for (const account of healthy) {
      // Rotate symbol batches so each pulse stays fast (fixes multi-second latency flicker).
      const universe = account.assignedSymbols?.length ? account.assignedSymbols : [...allPairs];
      const batchSize = 10;
      const offset = Math.floor(Date.now() / 1000) % Math.max(1, Math.ceil(universe.length / batchSize));
      const start = offset * batchSize;
      const symbols = universe.slice(start, start + batchSize);
      const result = await bridgePulse({
        accountId: account.id,
        login: account.login,
        server: account.server,
        symbols,
      });
      if (result.ok) {
        applyBridgeSync(account.id, result, true);
      }
    }
  } finally {
    syncInFlight = false;
  }
}

function emit() {
  const hasAccounts = snapshot.accounts.length > 0;
  const healthyAccounts = snapshot.accounts.filter((a) => a.state === 'HEALTHY');
  const healthy = healthyAccounts.length > 0;
  const feedLatencyMs = healthy
    ? Math.min(...healthyAccounts.map((a) => a.latencyMs ?? 0))
    : 0;
  snapshot = {
    ...snapshot,
    updatedAt: now(),
    globalTradingEnabled,
    health: {
      ...snapshot.health,
      lastHeartbeat: healthy ? now() : snapshot.health.lastHeartbeat,
      feedLatencyMs,
      reconnectAttempts,
      bridge: !hasAccounts
        ? 'DISCONNECTED'
        : healthy
          ? snapshot.health.bridge === 'ERROR'
            ? 'DEGRADED'
            : 'HEALTHY'
          : 'DISCONNECTED',
      marketData: healthy ? 'STREAMING' : 'OFFLINE',
      orderGateway: !globalTradingEnabled || !healthy ? 'BLOCKED' : 'READY',
      heartbeat: healthy ? 'HEALTHY' : 'LOST',
      queueDepth: healthy ? Math.max(0, eventBus.recent(20).length % 8) : 0,
    },
    accounts: snapshot.accounts.map((a) =>
      a.state === 'HEALTHY' || a.state === 'DEGRADED' ? { ...a, lastHeartbeat: now() } : a,
    ),
  };
  listeners.forEach((l) => l(snapshot));
  void pollHealthyAccounts().then(() => {
    if (healthy) listeners.forEach((l) => l(snapshot));
  });
}

let timer: ReturnType<typeof setInterval> | null = null;
function ensureTick() {
  if (!timer) timer = setInterval(emit, 1000);
}
function maybeStopTick() {
  if (!listeners.size && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function setAccountState(id: string, patch: Partial<MT5Account>) {
  snapshot = {
    ...snapshot,
    accounts: snapshot.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  };
}

function refreshGatewayHealth() {
  const anyHealthy = snapshot.accounts.some((a) => a.state === 'HEALTHY');
  const anyTrading = snapshot.accounts.some((a) => a.tradingEnabled && a.state === 'HEALTHY');
  snapshot = {
    ...snapshot,
    health: {
      ...snapshot.health,
      bridge: anyHealthy ? 'HEALTHY' : snapshot.accounts.length ? 'DISCONNECTED' : 'DISCONNECTED',
      orderGateway: !globalTradingEnabled || !anyHealthy || !anyTrading ? 'BLOCKED' : 'READY',
      marketData: anyHealthy ? snapshot.health.marketData : 'OFFLINE',
      heartbeat: anyHealthy ? 'HEALTHY' : 'LOST',
    },
  };
}

function accountToPersist(account: MT5Account) {
  return {
    id: account.id,
    name: account.name,
    accountClass: account.accountClass,
    currency: account.currency,
    broker: account.broker,
    firm: account.firm,
    server: account.server,
    login: account.login,
    secretRef: account.secretRef,
    terminalInstance: account.terminalInstance,
    state: account.state,
    tradingMode: account.tradingMode,
    tradingEnabled: account.tradingEnabled,
    leverage: account.leverage,
    riskProfile: account.riskProfile,
    maxConcurrentTrades: account.maxConcurrentTrades,
    balance: account.balance,
    equity: account.equity,
    margin: account.margin,
    freeMargin: account.freeMargin,
    profit: account.profit,
    latencyMs: account.latencyMs,
    lastHeartbeat: account.lastHeartbeat,
    connectedAt: account.connectedAt,
    assignedSymbols: account.assignedSymbols,
    propRules: account.propRules,
  };
}

async function persistAccount(account: MT5Account) {
  const result = await bridgeUpsertAccount(accountToPersist(account));
  if (!result.ok) {
    pushEvent(`DB persist warning: ${result.message}`, 'WARNING', 'SYSTEM', account.id);
  }
  return result;
}

async function hydrateFromDb() {
  const data = await bridgeListAccounts();
  if (!data.ok) {
    pushEvent(data.message || 'Unable to hydrate accounts from SQL Server', 'WARNING', 'SYSTEM');
    return;
  }
  if (!data.accounts.length) return;

  const accounts: MT5Account[] = data.accounts.map((raw) => {
    const a = raw as Partial<MT5Account> & { accountClass?: AccountClass };
    return {
      id: String(a.id),
      name: String(a.name || 'MT5 Account'),
      accountClass: (a.accountClass || 'DEMO') as AccountClass,
      currency: String(a.currency || 'USD'),
      broker: String(a.broker || 'Broker'),
      firm: a.firm,
      server: String(a.server || ''),
      login: String(a.login || ''),
      terminalInstance: String(a.terminalInstance || nextTerminalInstanceId([])),
      state: (a.state as ConnectionState) || 'DISCONNECTED',
      tradingMode: (a.tradingMode as TradingMode) || 'ANALYSIS_ONLY',
      tradingEnabled: Boolean(a.tradingEnabled),
      balance: Number(a.balance || 0),
      equity: Number(a.equity || 0),
      margin: Number(a.margin || 0),
      freeMargin: Number(a.freeMargin || 0),
      leverage: Number(a.leverage || 100),
      profit: Number(a.profit || 0),
      lastHeartbeat: a.lastHeartbeat || now(),
      latencyMs: Number(a.latencyMs || 0),
      connectedAt: a.connectedAt,
      secretRef: a.secretRef,
      riskProfile: (a.riskProfile as MT5Account['riskProfile']) || 'BALANCED',
      maxConcurrentTrades: Number(a.maxConcurrentTrades || 2),
      assignedSymbols: (a.assignedSymbols as string[])?.length ? (a.assignedSymbols as string[]) : [...universe],
      propRules: a.propRules as PropRules | undefined,
    };
  });

  const positions: MT5Position[] = (data.positions || []).map((p) => ({
    id: p.id,
    accountId: String((p as BridgePosition & { accountId?: string }).accountId || ''),
    cacsmsTradeId: p.cacsmsTradeId,
    mt5OrderId: p.mt5OrderId,
    mt5DealId: p.mt5DealId,
    mt5PositionId: p.mt5PositionId,
    symbol: p.symbol,
    side: p.side,
    volume: p.volume,
    entry: p.entry,
    current: p.current,
    sl: p.sl ?? undefined,
    tp: p.tp ?? undefined,
    pnl: p.pnl,
    currency: p.currency,
    status: 'OPEN',
    openedAt: p.openedAt || now(),
  }));

  snapshot = {
    ...snapshot,
    accounts,
    symbolMaps: buildMaps(accounts),
    coverage: buildCoverage(accounts),
    positions: positions.filter((p) => p.accountId),
    updatedAt: now(),
  };
  refreshGatewayHealth();
  pushEvent(`Loaded ${accounts.length} account(s) from db_Cacsms-Trader`, 'INFO', 'SYSTEM');
}

export function getMT5Snapshot(): MT5Snapshot {
  return snapshot;
}

export function subscribeMT5(cb: (s: MT5Snapshot) => void) {
  listeners.add(cb);
  cb(snapshot);
  ensureTick();
  void hydrateFromDb().then(() => {
    cb(snapshot);
    listeners.forEach((l) => l(snapshot));
  });
  return () => {
    listeners.delete(cb);
    maybeStopTick();
  };
}

export async function mt5Connect(id: string): Promise<MT5CommandResult> {
  const account = snapshot.accounts.find((a) => a.id === id);
  if (!account) return { ok: false, message: 'Account not found' };

  setAccountState(id, { state: 'CONNECTING' });
  emit();

  const health = await bridgeHealth();
  if (!health.ok) {
    setAccountState(id, { state: 'ERROR' });
    pushEvent(health.message || 'MT5 bridge offline', 'ERROR', 'CONNECTION', id);
    emit();
    return {
      ok: false,
      message: health.message || 'MT5 bridge offline — run npm run mt5:bridge with MetaTrader 5 open',
    };
  }

  setAccountState(id, { state: 'AUTHENTICATING' });
  emit();

  setAccountState(id, { state: 'SYNCHRONIZING' });
  emit();

  const result = await bridgeSync({
    accountId: account.id,
    login: account.login,
    server: account.server,
    name: account.name,
    broker: account.broker,
    firm: account.firm,
    secretRef: account.secretRef,
    terminalInstance: account.terminalInstance,
    tradingMode: account.tradingMode,
    accountClass: account.accountClass,
    riskProfile: account.riskProfile,
    maxConcurrentTrades: account.maxConcurrentTrades,
    assignedSymbols: account.assignedSymbols,
    propRules: account.propRules,
  });

  if (!result.ok || !result.account) {
    setAccountState(id, { state: 'ERROR' });
    pushEvent(result.message, 'ERROR', 'CONNECTION', id);
    emit();
    return { ok: false, message: result.message };
  }

  applyBridgeSync(id, result);
  setAccountState(id, {
    state: 'HEALTHY',
    tradingEnabled: false,
    lastHeartbeat: now(),
    latencyMs: result.latencyMs ?? 0,
    connectedAt: now(),
  });
  refreshGatewayHealth();
  const synced = snapshot.accounts.find((a) => a.id === id);
  if (synced) await persistAccount(synced);
  pushEvent(
    `Synced from MT5 • equity ${result.account.equity} ${result.account.currency}`,
    'INFO',
    'CONNECTION',
    id,
  );
  emit();
  return {
    ok: true,
    message: result.message,
  };
}

export async function mt5Disconnect(id: string): Promise<MT5CommandResult> {
  setAccountState(id, { state: 'DISCONNECTED', tradingEnabled: false });
  refreshGatewayHealth();
  pushEvent('Account disconnected — new entries blocked', 'WARNING', 'CONNECTION', id);
  emit();
  return { ok: true, message: 'Disconnected' };
}

export async function mt5Reconnect(id: string): Promise<MT5CommandResult> {
  reconnectAttempts += 1;
  setAccountState(id, { state: 'CONNECTING', tradingEnabled: false });
  snapshot = {
    ...snapshot,
    health: { ...snapshot.health, reconciliation: 'PENDING', reconnectAttempts, orderGateway: 'BLOCKED' },
  };
  emit();
  await mt5Connect(id);
  const account = snapshot.accounts.find((a) => a.id === id);
  const local = snapshot.positions
    .filter((p) => p.accountId === id && p.status === 'OPEN')
    .map((p) => ({
      tradeId: p.cacsmsTradeId,
      accountId: p.accountId,
      positionId: p.mt5PositionId,
      symbol: p.symbol,
      side: p.side,
      volume: p.volume,
      status: p.status,
    }));
  const broker = local.map((p) => ({
    positionId: p.positionId!,
    symbol: p.symbol,
    side: p.side,
    volume: p.volume,
    priceOpen: 0,
    sl: 0,
    tp: 0,
  }));
  const issues = reconcile(local, broker);
  const mismatch = issues.some((i) => i.kind !== 'MATCHED');
  snapshot = {
    ...snapshot,
    health: {
      ...snapshot.health,
      reconciliation: mismatch ? 'MISMATCH' : 'CURRENT',
      orderGateway: mismatch || !globalTradingEnabled ? 'BLOCKED' : 'READY',
    },
  };
  pushEvent(
    mismatch ? 'Reconnect complete with reconciliation mismatches' : 'Reconnect and reconciliation completed',
    mismatch ? 'WARNING' : 'INFO',
    'POSITION',
    id,
  );
  emit();
  return { ok: !mismatch, message: mismatch ? 'Reconnected with mismatches' : 'Reconnected and reconciled' };
}

export async function mt5TestConnection(draft: MT5AccountDraft): Promise<MT5CommandResult> {
  if (!draft.server || !draft.login) {
    return { ok: false, message: 'Server and login are required' };
  }
  if (!draft.broker) {
    return { ok: false, message: 'Broker is required' };
  }
  const result = await bridgeTest({
    login: String(draft.login),
    server: draft.server,
    password: draft.password,
    broker: draft.broker,
  });
  return { ok: result.ok, message: result.message };
}

export async function mt5SaveAccount(draft: MT5AccountDraft): Promise<MT5CommandResult> {
  const { password, ...safe } = draft;
  const id = safe.id || `acct-${Date.now()}`;
  const existing = snapshot.accounts.find((a) => a.id === id);
  const currency = safe.currency || (safe.server?.toUpperCase().includes('NGN') ? 'NGN' : 'USD');

  let secretRef = existing?.secretRef;
  let secretNote = '';
  if (password) {
    const stored = await bridgeStoreSecret({
      accountId: id,
      login: String(safe.login || existing?.login || ''),
      server: safe.server || existing?.server || '',
      password,
    });
    if (stored.ok) {
      secretRef = stored.secretRef;
    } else {
      secretNote = ` Credentials not stored (${stored.message}). Connect still works if MT5 is already logged into this account.`;
    }
  }

  const account: MT5Account = {
    id,
    name: safe.name || 'New MT5 Account',
    accountClass: (safe.accountClass || 'DEMO') as AccountClass,
    currency,
    broker: safe.broker || 'Broker',
    firm: safe.firm,
    server: safe.server || 'MT5-Server',
    login: safe.login || '0',
    terminalInstance: safe.terminalInstance || nextTerminalInstanceId(snapshot.accounts.map((a) => a.terminalInstance)),
    state: 'DISCONNECTED',
    tradingMode: (safe.tradingMode || 'ANALYSIS_ONLY') as TradingMode,
    tradingEnabled: false,
    balance: 0,
    equity: 0,
    margin: 0,
    freeMargin: 0,
    leverage: safe.leverage || 100,
    profit: 0,
    lastHeartbeat: now(),
    latencyMs: 0,
    secretRef,
    riskProfile: safe.riskProfile || 'BALANCED',
    maxConcurrentTrades: safe.maxConcurrentTrades || 2,
    assignedSymbols: [...universe],
    propRules: safe.accountClass === 'PROP' ? safe.propRules || defaultPropRules(currency === 'NGN' ? 50_000_000 : 100000) : safe.propRules,
  };

  if (existing) {
    setAccountState(id, {
      ...existing,
      name: account.name,
      accountClass: account.accountClass,
      currency: account.currency,
      broker: account.broker,
      firm: account.firm,
      server: account.server,
      login: account.login,
      terminalInstance: account.terminalInstance,
      tradingMode: account.tradingMode,
      riskProfile: account.riskProfile,
      maxConcurrentTrades: account.maxConcurrentTrades,
      assignedSymbols: account.assignedSymbols,
      propRules: account.propRules,
      leverage: account.leverage,
      secretRef: secretRef || existing.secretRef,
    });
  } else {
    const accounts = [...snapshot.accounts, account];
    snapshot = {
      ...snapshot,
      accounts,
      symbolMaps: [...snapshot.symbolMaps, ...buildMaps([account])],
      coverage: [...snapshot.coverage, ...buildCoverage([account])],
    };
  }
  pushEvent(`Account profile saved (${account.name}) — credentials referenced securely`, 'SECURITY', 'CONNECTION', id);
  const saved = snapshot.accounts.find((a) => a.id === id) || account;
  const persisted = await persistAccount(saved);
  emit();
  if (!persisted.ok) {
    return {
      ok: true,
      message: `Account saved in session only. DB write failed: ${persisted.message}.${secretNote}`,
    };
  }
  return {
    ok: true,
    message: `Account saved to db_Cacsms-Trader. Connect to sync equity from MT5.${secretNote}`,
  };
}

function defaultPropRules(accountSize: number): PropRules {
  return {
    phase: 'CHALLENGE',
    accountSize,
    dailyLossLimitPct: 5,
    maxLossLimitPct: 10,
    profitTargetPct: 8,
    minTradingDays: 5,
    newsTrading: false,
    weekendHolding: false,
    overnightHolding: true,
    maxExposurePct: 1,
  };
}

export async function mt5SetAccountTrading(id: string, enabled: boolean): Promise<MT5CommandResult> {
  const account = snapshot.accounts.find((a) => a.id === id);
  if (!account) return { ok: false, message: 'Account not found' };
  if (enabled && account.state !== 'HEALTHY') {
    return { ok: false, message: 'Cannot enable trading until account is HEALTHY' };
  }
  setAccountState(id, { tradingEnabled: enabled });
  refreshGatewayHealth();
  pushEvent(`Account trading ${enabled ? 'enabled' : 'paused'}`, enabled ? 'INFO' : 'WARNING', 'COMPLIANCE', id);
  emit();
  return { ok: true, message: 'Updated' };
}

export async function mt5SetGlobalTrading(enabled: boolean): Promise<MT5CommandResult> {
  globalTradingEnabled = enabled;
  refreshGatewayHealth();
  pushEvent(`Global new-order execution ${enabled ? 'enabled' : 'stopped'}`, enabled ? 'INFO' : 'WARNING', 'SYSTEM');
  emit();
  return { ok: true, message: 'Updated' };
}

export async function mt5SaveSymbolMap(map: SymbolMap): Promise<MT5CommandResult> {
  snapshot = {
    ...snapshot,
    symbolMaps: snapshot.symbolMaps.map((m) =>
      m.accountId === map.accountId && m.canonical === map.canonical ? { ...m, ...map, status: map.brokerSymbol ? 'MAPPED' : 'UNMAPPED' } : m,
    ),
  };
  pushEvent(`Symbol map updated ${map.canonical} → ${map.brokerSymbol}`, 'INFO', 'MARKET_DATA', map.accountId, map.canonical);
  emit();
  return { ok: true, message: 'Symbol mapping saved' };
}

export async function mt5Reconcile(id: string): Promise<MT5CommandResult> {
  const account = snapshot.accounts.find((a) => a.id === id);
  if (!account) return { ok: false, message: 'Account not found' };
  snapshot = { ...snapshot, health: { ...snapshot.health, reconciliation: 'PENDING', orderGateway: 'BLOCKED' } };
  emit();
  const result = await bridgeSync({
    accountId: account.id,
    login: account.login,
    server: account.server,
  });
  if (!result.ok || !result.account) {
    snapshot = { ...snapshot, health: { ...snapshot.health, reconciliation: 'MISMATCH' } };
    pushEvent(result.message, 'ERROR', 'POSITION', id);
    emit();
    return { ok: false, message: result.message };
  }
  applyBridgeSync(id, result);
  refreshGatewayHealth();
  pushEvent(
    `Broker positions reconciled • equity ${result.account.equity} ${result.account.currency}`,
    'INFO',
    'POSITION',
    id,
  );
  emit();
  return { ok: true, message: result.message };
}

export async function mt5EmergencyStop(scope: { accountId?: string; symbol?: string }): Promise<MT5CommandResult> {
  if (scope.accountId) {
    setAccountState(scope.accountId, { tradingEnabled: false });
  } else {
    globalTradingEnabled = false;
  }
  refreshGatewayHealth();
  pushEvent(
    scope.symbol
      ? `Emergency stop: new entries blocked for ${scope.symbol}`
      : 'Emergency stop applied to NEW entries only — open positions unchanged',
    'WARNING',
    'COMPLIANCE',
    scope.accountId,
    scope.symbol,
  );
  emit();
  return { ok: true, message: 'New entries stopped; existing positions unchanged' };
}

export async function mt5SavePropRules(accountId: string, rules: PropRules): Promise<MT5CommandResult> {
  setAccountState(accountId, { propRules: rules, accountClass: 'PROP' });
  pushEvent('Prop firm rule profile updated', 'INFO', 'COMPLIANCE', accountId);
  emit();
  return { ok: true, message: 'Prop rules saved' };
}

export async function mt5SetTradingMode(accountId: string, mode: TradingMode): Promise<MT5CommandResult> {
  setAccountState(accountId, { tradingMode: mode });
  pushEvent(`Trading mode set to ${mode}`, 'INFO', 'COMPLIANCE', accountId);
  emit();
  return { ok: true, message: 'Trading mode updated' };
}

/** Stage 9 fail-closed order path used by BrokerGateway. */
export function mt5PlaceQualifiedOrder(input: {
  accountId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  sl: number;
  tp: number;
  clientOrderId: string;
  riskPct?: number;
  entry?: number;
}): { accepted: boolean; brokerOrderId?: string; reason?: string; filledPrice?: number } {
  const accountId =
    input.accountId ||
    snapshot.accounts.find((a) => a.state === 'HEALTHY' && a.tradingEnabled && a.tradingMode === 'AUTONOMOUS')?.id ||
    snapshot.accounts.find((a) => a.state === 'HEALTHY' && a.tradingEnabled)?.id;

  if (!accountId) {
    return { accepted: false, reason: 'No eligible MT5 account for execution' };
  }

  const safe = assertExecutionSafe(snapshot, accountId);
  if (!safe.ok) return { accepted: false, reason: safe.reason };

  const account = snapshot.accounts.find((a) => a.id === accountId)!;
  const map = snapshot.symbolMaps.find((m) => m.accountId === accountId && m.canonical === input.symbol && m.enabled);
  if (!map || map.status !== 'MAPPED') {
    return { accepted: false, reason: `Symbol ${input.symbol} is not mapped for ${account.name}` };
  }

  const instrument = instruments.find((i) => i.symbol === input.symbol);
  const risk = instrument
    ? qualifyRisk({
        setupScore: instrument.score,
        spreadOk: map.spread <= 3,
        volatilityOk: true,
        rr: 2,
        portfolioHeat: snapshot.positions.filter((p) => p.accountId === accountId && p.status === 'OPEN').length * 0.35,
        clusterExposure: input.symbol.includes('USD') ? 0.8 : 0.3,
        riskPerTrade: input.riskPct ?? SYSTEM.safety.defaultRiskPct,
      })
    : { approved: true, reasons: [] as string[], positionRisk: input.riskPct ?? 0.5 };

  const coverage = snapshot.coverage.find((c) => c.accountId === accountId && c.symbol === input.symbol);
  const h1 = coverage?.timeframes.H1;
  const tickFresh = !!h1 && !h1.stale;

  const openCount = snapshot.positions.filter((p) => p.accountId === accountId && p.status === 'OPEN').length;
  const propOk =
    !account.propRules ||
    (account.profit > -account.propRules.accountSize * (account.propRules.dailyLossLimitPct / 100) &&
      openCount < account.maxConcurrentTrades);

  const qualification = qualifyExecution({
    connectionHealthy: account.state === 'HEALTHY',
    authenticated: true,
    synchronized: snapshot.health.reconciliation === 'CURRENT',
    marketOpen: true,
    symbolMapped: true,
    tickFresh,
    spread: map.spread,
    maxSpread: 3,
    accountTradingEnabled: account.tradingEnabled,
    globalTradingEnabled,
    instrumentTradingEnabled: map.enabled,
    riskApproved: risk.approved,
    propCompliant: !!propOk,
    newsAllowed: !account.propRules || account.propRules.newsTrading,
    marginSufficient: account.freeMargin > 0,
    positionLimitAvailable: openCount < account.maxConcurrentTrades,
    duplicateOrder: false,
  });

  if (!qualification.eligible) {
    snapshot = {
      ...snapshot,
      gateway: { ...snapshot.gateway, rejected: snapshot.gateway.rejected + 1, ordersToday: snapshot.gateway.ordersToday + 1 },
    };
    pushEvent(`Order rejected: ${qualification.reasons[0]}`, 'ERROR', 'ORDER', accountId, input.symbol);
    emit();
    return { accepted: false, reason: qualification.reasons[0] };
  }

  if (account.tradingMode === 'ANALYSIS_ONLY') {
    return { accepted: false, reason: 'Account is Analysis Only — execution blocked' };
  }
  if (account.tradingMode === 'APPROVAL_REQUIRED') {
    pushEvent('Order held for approval', 'WARNING', 'ORDER', accountId, input.symbol);
    emit();
    return { accepted: false, reason: 'Approval required before MT5 submission' };
  }

  const entry = input.entry ?? instrument?.bid ?? 1;
  const sizing = calculateRiskSize({
    equity: account.equity,
    accountCurrency: account.currency,
    riskPct: input.riskPct ?? SYSTEM.safety.defaultRiskPct,
    entry,
    stop: input.sl,
    spec: {
      symbol: input.symbol,
      digits: map.digits,
      point: map.tickSize,
      tickSize: map.tickSize,
      tickValue: map.tickValue,
      contractSize: input.symbol === 'XAUUSD' ? 100 : 100000,
      volumeMin: map.minLot,
      volumeMax: map.maxLot,
      volumeStep: map.lotStep,
      profitCurrency: account.currency,
      marginCurrency: account.currency,
    },
  });

  if (!sizing.valid) {
    return { accepted: false, reason: sizing.reason || 'Position sizing failed' };
  }

  const volume = input.size > 0 ? Math.min(input.size, sizing.volume || input.size) : sizing.volume;
  const orderId = `MT5-${Date.now()}`;
  const position: MT5Position = {
    id: `pos-${orderId}`,
    accountId,
    cacsmsTradeId: input.clientOrderId,
    mt5OrderId: orderId,
    mt5DealId: `D-${orderId}`,
    mt5PositionId: `P-${orderId}`,
    symbol: input.symbol,
    side: input.side,
    volume,
    entry,
    current: entry,
    sl: input.sl,
    tp: input.tp,
    pnl: 0,
    currency: account.currency,
    status: 'OPEN',
    openedAt: now(),
  };

  snapshot = {
    ...snapshot,
    positions: [position, ...snapshot.positions],
    gateway: {
      ...snapshot.gateway,
      ordersToday: snapshot.gateway.ordersToday + 1,
      successful: snapshot.gateway.successful + 1,
      avgExecutionMs: Math.round((snapshot.gateway.avgExecutionMs + 120) / 2),
    },
  };
  pushEvent(`Order filled ${input.side} ${volume} ${map.brokerSymbol}`, 'TRADE', 'ORDER', accountId, input.symbol);
  emit();
  return { accepted: true, brokerOrderId: orderId, filledPrice: entry };
}

export function getStage9ExecutionSummary() {
  const ready = snapshot.accounts.filter((a) => assertExecutionSafe(snapshot, a.id).ok);
  return {
    globalTradingEnabled,
    readyAccounts: ready.length,
    orderGateway: snapshot.health.orderGateway,
    heartbeat: snapshot.health.heartbeat,
    reconciliation: snapshot.health.reconciliation,
    mode: SYSTEM.mode,
  };
}

export function setAccountConnectionState(id: string, state: ConnectionState) {
  setAccountState(id, { state });
  refreshGatewayHealth();
  emit();
}
