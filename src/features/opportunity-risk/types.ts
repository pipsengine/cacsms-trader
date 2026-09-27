export type RiskState =
  | 'EVALUATING'
  | 'QUALIFIED'
  | 'WAITING'
  | 'RISK_BLOCKED'
  | 'CORRELATION_BLOCKED'
  | 'EXPOSURE_BLOCKED'
  | 'ACCOUNT_BLOCKED'
  | 'PROP_RULE_BLOCKED'
  | 'MARGIN_BLOCKED'
  | 'STALE'
  | 'EXPIRED'
  | 'AUTHORIZED';

export type GateStatus = 'PASS' | 'FAIL' | 'WAIT' | 'N/A' | 'STALE';

export type RiskGate = { status: GateStatus; detail: string; value?: number; limit?: number };

export type Failure = { state: RiskState; code: string; reason: string };

export type ScoreComponent = { key: string; label: string; points: number; max: number; detail: string };

export type Target = { price: number; boundary: number; label: string; distanceAtr?: number };

export type Geometry = {
  atr: number | null;
  bid: number | null;
  ask: number | null;
  tickAgeSec: number | null;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number | null;
  takeProfit2?: number | null;
  stopDistance?: number;
  stopAtr?: number;
  lossPerUnit?: number;
  slippage?: number;
  spread?: number;
  spreadAtr?: number;
  spreadStopPct?: number | null;
  rewardRisk?: number | null;
  driftAtr?: number | null;
  referenceClose?: number | null;
  invalidation?: number;
  targets?: Target[];
  mid?: number;
};

export type Sizing = {
  targetRiskPct?: number;
  allowedRiskPct?: number;
  basis?: number;
  basisType?: string;
  lossPerUnit?: number;
  contractSize?: number;
  profitCurrency?: string;
  fxRate?: number;
  fxSource?: string;
  lossPerLot?: number;
  hypotheticalAtTarget?: boolean;
  riskMoneyAllowed?: number;
  volumeRaw?: number;
  volumeMin?: number;
  volumeMax?: number;
  volumeStep?: number;
  minVolumeRiskPct?: number;
  volume?: number;
  riskMoney?: number;
  riskPct?: number;
  rewardMoney?: number | null;
  marginRequired?: number;
  marginMethod?: string;
  freeMarginAfter?: number;
  marginLevelAfter?: number | null;
  marginUsePct?: number;
};

export type Constraint = { key: string; label: string; headroomPct: number; state: RiskState; code: string; detail: string; ok?: boolean };

export type CurrencyRow = { currency: string; sign: number; net: number; headroomPct: number };

export type ClusterRow = { kind: string; symbol: string; d: number; riskPct: number; rho: number | null; signed: number | null; basis: string };

export type PropHeadroom = Record<string, Record<string, number | boolean | string | null>>;

export type AccountEval = {
  accountId: string;
  name: string;
  accountClass: 'DEMO' | 'LIVE' | 'PROP' | string;
  currency: string;
  live: boolean;
  login?: string;
  server?: string;
  tradingMode?: string;
  tradingEnabled: boolean;
  state: RiskState;
  reasonCode: string;
  reason: string;
  hypothetical: boolean;
  failures: Failure[];
  gates: Record<string, RiskGate>;
  sizing: Sizing;
  constraints: Constraint[];
  exposure: { currencies?: CurrencyRow[]; cluster?: ClusterRow[]; clusterRiskPct?: number; committedPct?: number };
  prop: { applies?: boolean; headroom?: PropHeadroom; blocks?: { code: string; reason: string }[] };
  authorization: Authorization | null;
  existingAuthorization?: string;
};

export type Opportunity = {
  setupKey: string;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  side: 'BUY' | 'SELL';
  setupState: RiskState;
  setupReasonCode: string;
  setupReason: string;
  setupFailures: Failure[];
  score: number;
  components: ScoreComponent[];
  confidence: number;
  gates: Record<string, RiskGate>;
  geometry: Geometry;
  confirmedSince: string | null;
  expiresAt: string | null;
  stage7: {
    confidence: number;
    model?: string;
    trigger?: string;
    triggerTs?: number | string;
    triggerLevel?: number;
    invalidationLevel?: number;
    riskAtr?: number;
    h1LastTs?: number;
    freshness?: string;
    zone?: string;
    reasoning?: string[] | string;
  };
  accounts: AccountEval[];
  eligibleAccounts: number;
  authorizedAccounts: number;
  state: RiskState;
  reasonCode: string;
  reason: string;
  proposedRiskPct: number | null;
  exposureStatus: string;
  active: boolean;
  changedAt: string | null;
  evaluatedAt: string | null;
  trigger?: string | null;
};

export type Authorization = {
  executionId: string;
  setupKey: string;
  attempt: number;
  accountId: string;
  accountName?: string;
  accountClass?: string;
  accountCurrency: string;
  instrument: string;
  brokerSymbol: string;
  direction: 'BUY' | 'SELL';
  volume: number;
  entryPolicy: {
    type: string;
    referencePrice: number;
    maxDeviationPrice: number;
    maxDeviationPoints: number;
    maxSpread: number;
    validFrom: string;
    validUntil: string;
  };
  stopLoss: number;
  takeProfit: number | null;
  takeProfit2?: number | null;
  riskAmount: number;
  riskCurrency: string;
  riskPct: number;
  rewardRisk?: number | null;
  marginRequired: number;
  expiresAt: string;
  authorizedAt: string;
  configHash?: string;
  source: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: 'PENDING' | 'CONSUMED' | 'DECLINED' | 'EXPIRED' | 'REVOKED' | string;
  statusReason?: string | null;
  statusAt?: string | null;
  executes: false;
};

export type Utilization = { used: number | null; limit: number };

export type AccountSummary = {
  accountId: string;
  name: string;
  accountClass: string;
  currency: string;
  login?: string;
  server?: string;
  live: boolean;
  snapshotAgeSec: number | null;
  status: 'ELIGIBLE' | 'ANALYSIS_ONLY' | 'TRADING_DISABLED' | 'ACCOUNT_BLOCKED' | string;
  issues: { code: string; reason: string }[];
  tradingEnabled: boolean;
  tradingMode?: string;
  balance: number;
  equity: number;
  freeMargin: number;
  margin: number;
  marginLevel: number | null;
  leverage: number;
  basis: number;
  openRiskPct: number;
  pendingRiskPct: number;
  availableRiskPct: number;
  dailyLossPct: number | null;
  drawdownPct: number;
  dayStartEquity: number | null;
  peakEquity: number;
  baselineSource?: string;
  dayPnl?: number;
  utilization: Record<'portfolio' | 'dailyLoss' | 'drawdown' | 'positions' | 'marginLevel', Utilization>;
  currencies: { currency: string; netPct: number; limit: number }[];
  unknownRisk: string[];
  positions: { symbol: string; side: string; volume: number; entry: number; sl: number | null; tp: number | null; pnl: number; known: boolean; reason?: string; riskPct: number | null }[];
  propRules: Record<string, unknown> | null;
};

export type RiskCounters = {
  candidates: number;
  qualified: number;
  authorized: number;
  eligible: number;
  waiting: number;
  blocked: number;
  stale: number;
  expired: number;
  accounts: number;
  eligibleAccounts: number;
  byState: Partial<Record<RiskState, number>>;
};

export type RiskRun = {
  status: 'HEALTHY' | 'DEGRADED' | string;
  message: string;
  runs: number;
  errors: number;
  runAt: string;
  triggers: string[];
  counters: RiskCounters;
  accounts: AccountSummary[];
  auto: boolean;
  terminal: { login?: string; server?: string; company?: string; currency?: string; leverage?: number; accountId?: string | null } | null;
  configHash: string;
  changes: string[];
  upstream: { h1RunAt: string | null; h1Status: string; confirmed: number };
  service: Record<string, number>;
  durationMs: number;
  created: string[];
  revoked: string[];
  expired: string[];
  changed: number;
};

export type RiskHistoryRow = {
  id: number;
  setupKey: string;
  accountId: string | null;
  symbol: string;
  state: RiskState;
  prevState: RiskState | null;
  reasonCode: string;
  reason: string;
  score: number | null;
  volume: number | null;
  riskPct: number | null;
  trigger: string | null;
  createdAt: string;
};

export type RiskRunRow = {
  id: number;
  runAt: string;
  triggers: string;
  status: string;
  candidates: number;
  qualified: number;
  authorized: number;
  blocked: number;
  changed: number;
  durationMs: number;
};

export type ConfigAudit = {
  id: number;
  changedAt: string;
  actor: string;
  changedKeys: string;
  critical: boolean;
  beforeHash: string;
  afterHash: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
};

export type RiskConfig = Record<string, number | string | boolean | { mode: string; events: unknown[] }>;

export type RiskStateResponse = {
  ok: boolean;
  run: RiskRun | null;
  opportunities: Opportunity[];
  authorizations: Authorization[];
  history: RiskHistoryRow[];
  runs: RiskRunRow[];
  config: RiskConfig;
  configErrors?: string[] | null;
  overrides: RiskConfig;
  configHash: string;
  defaults: RiskConfig;
  bounds: Record<string, [number, number]>;
  criticalKeys: string[];
  audit: ConfigAudit[];
  service?: { status?: string; message?: string; runAt?: string; runs?: number; errors?: number; lastError?: string | null };
};

export type RiskDetail = {
  ok: boolean;
  setupKey: string;
  opportunity: Opportunity | null;
  history: RiskHistoryRow[];
  authorizations: Authorization[];
  authorizationEvents: { executionId: string; status: string; reason: string; createdAt: string }[];
};
