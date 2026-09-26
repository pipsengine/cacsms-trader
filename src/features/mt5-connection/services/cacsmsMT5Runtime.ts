import { allPairs, instruments, positions as seedPositions } from '../../../data/market';
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
import type {
  AccountClass,
  ConnectionState,
  MT5Account,
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
let globalTradingEnabled = true;
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
      brokerSymbol: a.id.includes('ngn') && s === 'XAUUSD' ? 'GOLD' : a.accountClass === 'PROP' ? `${s}.pro` : s,
      enabled: true,
      digits: s.includes('JPY') || s === 'XAUUSD' ? 3 : 5,
      minLot: 0.01,
      maxLot: 100,
      lotStep: 0.01,
      tickSize: s === 'XAUUSD' ? 0.01 : 0.00001,
      tickValue: a.currency === 'NGN' ? 1600 : 1,
      spread: Number((0.4 + (i % 7) * 0.15).toFixed(2)),
      status: 'MAPPED' as const,
    })),
  );
}

function buildCoverage(accounts: MT5Account[]) {
  return accounts.flatMap((a) =>
    universe.map((symbol, si) => ({
      accountId: a.id,
      symbol,
      timeframes: Object.fromEntries(
        TIMEFRAMES.map((tf, ti) => [
          tf,
          {
            available: true,
            bars: Math.max(400, 62000 - Math.floor(ti * 5900) - si * 31),
            lastBar: now(),
            stale: false,
          },
        ]),
      ),
      lastSync: now(),
    })),
  );
}

const seedAccounts: MT5Account[] = [
  {
    id: 'demo-usd',
    name: 'Strategy Validation',
    accountClass: 'DEMO',
    currency: 'USD',
    broker: 'Demo Broker',
    server: 'Demo-MT5',
    login: '100001',
    terminalInstance: 'CACSMS-MT5-0001',
    state: 'HEALTHY',
    tradingMode: 'AUTONOMOUS',
    tradingEnabled: true,
    balance: 50000,
    equity: 50384,
    margin: 620,
    freeMargin: 49764,
    leverage: 100,
    profit: 384,
    lastHeartbeat: now(),
    latencyMs: 38,
    riskProfile: 'BALANCED',
    maxConcurrentTrades: 3,
    assignedSymbols: [...universe],
  },
  {
    id: 'live-ngn',
    name: 'Nigeria Live',
    accountClass: 'LIVE',
    currency: 'NGN',
    broker: 'Nigeria Broker',
    server: 'Live-NGN',
    login: '200002',
    terminalInstance: 'CACSMS-MT5-0002',
    state: 'HEALTHY',
    tradingMode: 'APPROVAL_REQUIRED',
    tradingEnabled: true,
    balance: 30_000_000,
    equity: 30_435_000,
    margin: 850_000,
    freeMargin: 29_585_000,
    leverage: 100,
    profit: 435_000,
    lastHeartbeat: now(),
    latencyMs: 51,
    riskProfile: 'CONSERVATIVE',
    maxConcurrentTrades: 2,
    assignedSymbols: [...universe],
  },
  {
    id: 'live-usd',
    name: 'Personal Live USD',
    accountClass: 'LIVE',
    currency: 'USD',
    broker: 'Global Broker',
    server: 'Live-01',
    login: '300003',
    terminalInstance: 'CACSMS-MT5-0003',
    state: 'HEALTHY',
    tradingMode: 'AUTONOMOUS',
    tradingEnabled: true,
    balance: 25000,
    equity: 25242,
    margin: 410,
    freeMargin: 24832,
    leverage: 200,
    profit: 242,
    lastHeartbeat: now(),
    latencyMs: 44,
    riskProfile: 'BALANCED',
    maxConcurrentTrades: 3,
    assignedSymbols: [...universe],
  },
  {
    id: 'prop-usd',
    name: 'Prop 100K',
    accountClass: 'PROP',
    currency: 'USD',
    broker: 'Prop Broker',
    firm: 'Example Prop Firm',
    server: 'Funded-01',
    login: '400004',
    terminalInstance: 'CACSMS-MT5-0004',
    state: 'HEALTHY',
    tradingMode: 'AUTONOMOUS',
    tradingEnabled: true,
    balance: 100000,
    equity: 102430,
    margin: 1350,
    freeMargin: 101080,
    leverage: 100,
    profit: 2430,
    lastHeartbeat: now(),
    latencyMs: 62,
    riskProfile: 'CONSERVATIVE',
    maxConcurrentTrades: 2,
    assignedSymbols: [...universe],
    propRules: {
      phase: 'FUNDED',
      accountSize: 100000,
      dailyLossLimitPct: 5,
      maxLossLimitPct: 10,
      profitTargetPct: 8,
      minTradingDays: 5,
      newsTrading: false,
      weekendHolding: false,
      overnightHolding: true,
      maxExposurePct: 1,
      consistencyRulePct: 30,
    },
  },
];

function seedMt5Positions(): MT5Position[] {
  const open = seedPositions.filter((p) => p.status === 'ACTIVE');
  return open.map((p, i) => ({
    id: `mt5-p-${p.id}`,
    accountId: i === 0 ? 'demo-usd' : 'live-ngn',
    cacsmsTradeId: p.id,
    mt5OrderId: `92${p.id.replace(/\D/g, '') || '1000'}`,
    mt5DealId: `93${p.id.replace(/\D/g, '') || '1000'}`,
    mt5PositionId: `94${p.id.replace(/\D/g, '') || '1000'}`,
    symbol: p.symbol,
    side: p.side,
    volume: p.size,
    entry: p.entry,
    current: p.current,
    sl: p.sl,
    tp: p.tp,
    pnl: i === 1 ? p.pnl * 1600 : p.pnl,
    currency: i === 1 ? 'NGN' : 'USD',
    status: 'OPEN',
    openedAt: now(),
  }));
}

let snapshot: MT5Snapshot = {
  accounts: seedAccounts,
  symbolMaps: buildMaps(seedAccounts),
  coverage: buildCoverage(seedAccounts),
  gateway: {
    pending: 0,
    ordersToday: 7,
    successful: 7,
    rejected: 0,
    avgExecutionMs: 138,
    avgSlippagePips: 0.24,
  },
  health: {
    bridge: 'HEALTHY',
    marketData: 'STREAMING',
    orderGateway: 'READY',
    heartbeat: 'HEALTHY',
    reconciliation: 'CURRENT',
    queueDepth: 2,
    reconnectAttempts: 0,
    lastHeartbeat: now(),
    feedLatencyMs: 43,
  },
  events: [],
  positions: seedMt5Positions(),
  globalTradingEnabled: true,
  updatedAt: now(),
};

pushEvent('MT5 gateway attached to Cacsms Trader runtime', 'INFO', 'SYSTEM');
pushEvent('29-instrument universe synchronized', 'INFO', 'MARKET_DATA');

function emit() {
  const healthy = snapshot.accounts.some((a) => a.state === 'HEALTHY');
  snapshot = {
    ...snapshot,
    updatedAt: now(),
    globalTradingEnabled,
    health: {
      ...snapshot.health,
      lastHeartbeat: now(),
      feedLatencyMs: 30 + Math.floor(Math.random() * 35),
      reconnectAttempts,
      bridge: healthy ? snapshot.health.bridge === 'ERROR' ? 'DEGRADED' : snapshot.health.bridge : 'DEGRADED',
      marketData: healthy ? 'STREAMING' : 'STALE',
      orderGateway: !globalTradingEnabled ? 'BLOCKED' : healthy ? 'READY' : 'DEGRADED',
      heartbeat: healthy ? 'HEALTHY' : 'STALE',
      queueDepth: Math.max(0, eventBus.recent(20).length % 8),
    },
    accounts: snapshot.accounts.map((a) =>
      a.state === 'HEALTHY' || a.state === 'DEGRADED'
        ? { ...a, lastHeartbeat: now(), latencyMs: 30 + Math.floor(Math.random() * 40) }
        : a,
    ),
  };
  listeners.forEach((l) => l(snapshot));
}

let timer: ReturnType<typeof setInterval> | null = null;
function ensureTick() {
  if (!timer) timer = setInterval(emit, 2000);
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
      orderGateway: !globalTradingEnabled ? 'BLOCKED' : anyHealthy && anyTrading ? 'READY' : 'DEGRADED',
      reconciliation: 'CURRENT',
    },
  };
}

export function getMT5Snapshot(): MT5Snapshot {
  return snapshot;
}

export function subscribeMT5(cb: (s: MT5Snapshot) => void) {
  listeners.add(cb);
  cb(snapshot);
  ensureTick();
  return () => {
    listeners.delete(cb);
    maybeStopTick();
  };
}

export async function mt5Connect(id: string): Promise<MT5CommandResult> {
  setAccountState(id, { state: 'CONNECTING' });
  emit();
  await new Promise((r) => setTimeout(r, 250));
  setAccountState(id, { state: 'AUTHENTICATING' });
  emit();
  await new Promise((r) => setTimeout(r, 250));
  setAccountState(id, { state: 'SYNCHRONIZING' });
  emit();
  await new Promise((r) => setTimeout(r, 250));
  setAccountState(id, { state: 'HEALTHY', lastHeartbeat: now(), tradingEnabled: true });
  refreshGatewayHealth();
  pushEvent('Account connected and synchronized', 'INFO', 'CONNECTION', id);
  emit();
  return { ok: true, message: 'Connected • synchronized • reconciliation current' };
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

export async function mt5TestConnection(draft: Partial<MT5Account>): Promise<MT5CommandResult> {
  await new Promise((r) => setTimeout(r, 500));
  if (!draft.server || !draft.login) {
    return { ok: false, message: 'Server and login are required' };
  }
  return {
    ok: true,
    message: `Terminal reachable • auth valid • market data available • trade permission detected (${draft.accountClass || 'DEMO'})`,
  };
}

export async function mt5SaveAccount(draft: Partial<MT5Account> & { password?: string }): Promise<MT5CommandResult> {
  const { password: _password, ...safe } = draft as Partial<MT5Account> & { password?: string };
  void _password; // never persist credentials in browser state
  const id = safe.id || `acct-${Date.now()}`;
  const existing = snapshot.accounts.find((a) => a.id === id);
  const currency = safe.currency || (safe.server?.toUpperCase().includes('NGN') ? 'NGN' : 'USD');
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
    balance: currency === 'NGN' ? 10_000_000 : 10000,
    equity: currency === 'NGN' ? 10_000_000 : 10000,
    margin: 0,
    freeMargin: currency === 'NGN' ? 10_000_000 : 10000,
    leverage: safe.leverage || 100,
    profit: 0,
    riskProfile: safe.riskProfile || 'BALANCED',
    maxConcurrentTrades: safe.maxConcurrentTrades || 2,
    assignedSymbols: [...universe],
    propRules: safe.accountClass === 'PROP' ? safe.propRules || defaultPropRules(currency === 'NGN' ? 50_000_000 : 100000) : safe.propRules,
  };

  if (existing) {
    setAccountState(id, { ...existing, ...account, id });
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
  emit();
  return { ok: true, message: 'Account saved. Connect to authenticate and detect deposit currency from MT5.' };
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
  snapshot = { ...snapshot, health: { ...snapshot.health, reconciliation: 'PENDING', orderGateway: 'BLOCKED' } };
  emit();
  await new Promise((r) => setTimeout(r, 300));
  snapshot = { ...snapshot, health: { ...snapshot.health, reconciliation: 'CURRENT' } };
  refreshGatewayHealth();
  pushEvent('Broker positions reconciled with Cacsms world model', 'INFO', 'POSITION', id);
  emit();
  return { ok: true, message: 'Reconciliation complete' };
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
