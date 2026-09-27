import type { Authorization } from '../opportunity-risk/types';

export type OrderState =
  | 'AUTHORIZED'
  | 'QUEUED'
  | 'REVALIDATING'
  | 'SUBMITTING'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN'
  | 'RECONCILING';

export type PositionState = 'OPEN' | 'PROTECTED' | 'MANAGING' | 'PARTIAL_EXIT' | 'BREAKEVEN' | 'TRAILING' | 'EXIT_PENDING' | 'CLOSED' | 'ERROR';

export type ControlStateName = 'RUNNING' | 'EMERGENCY_STOP' | 'MT5_DISCONNECTED' | 'RECONCILING' | 'EXECUTION_DISABLED' | 'TRADING_PAUSED' | 'ANALYSIS_PAUSED';

export type Check = { key: string; label: string; status: 'PASS' | 'FAIL' | 'WAIT'; detail: string };

export type Revalidation = {
  ok: boolean;
  terminal: boolean;
  code: string;
  reason: string;
  checks: Check[];
  order: {
    entry?: number;
    bid?: number;
    ask?: number;
    spread?: number;
    spreadPoints?: number;
    deviation?: number;
    deviationPoints?: number;
    volume?: number;
    riskNow?: number;
    riskLimit?: number;
    fxRate?: number;
    marginRequired?: number;
  };
  at: string;
};

export type Management = {
  protected?: boolean;
  beDone?: boolean;
  trailing?: boolean;
  partialDone?: boolean;
  partialTaken?: boolean;
  partialPending?: { expectedVolume: number; at: string } | null;
  exitPending?: boolean;
  exitCode?: string;
  exitReason?: string;
  exitRequest?: { actor: string; reason: string; at: string };
  forcedExit?: { code: string; reason: string };
  error?: string;
};

/** One Stage 9 execution: the idempotent ledger document keyed by execution ID. */
export type Execution = {
  executionId: string;
  setupKey: string;
  attempt: number;
  accountId: string;
  accountName?: string | null;
  accountClass: string;
  accountCurrency?: string | null;
  instrument: string;
  brokerSymbol: string;
  direction: string;
  entryType: string;
  authVolume: number;
  authSl: number | null;
  authTp: number | null;
  referencePrice?: number | null;
  riskAmount?: number | null;
  riskPct?: number | null;
  authExpiresAt?: string | null;
  node?: string | null;
  orderState: OrderState;
  positionState: PositionState | null;
  stateReason?: string | null;
  blockerCode?: string | null;
  revalidation?: Revalidation | null;
  requotes?: number;
  mgmt?: Management;
  authorization?: Authorization | null;
  stale?: boolean;
  virtual?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  consumedAt?: string | null;
  submitAttemptedAt?: string | null;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  filledAt?: string | null;
  mt5Order?: number | null;
  mt5Deal?: number | null;
  mt5Position?: number | null;
  requestedPrice?: number | null;
  fillPrice?: number | null;
  filledVolume?: number | null;
  openVolume?: number | null;
  slippagePoints?: number | null;
  latencyMs?: number | null;
  spreadAtSubmit?: number | null;
  protectiveSl?: number | null;
  targetTp?: number | null;
  brokerSl?: number | null;
  brokerTp?: number | null;
  currentPrice?: number | null;
  unrealizedPnl?: number | null;
  initialRiskDistance?: number | null;
  initialRiskMoney?: number | null;
  riskNowMoney?: number | null;
  riskNowPct?: number | null;
  currentR?: number | null;
  nextAction?: string | null;
  exitPrice?: number | null;
  realizedPnl?: number | null;
  exitReason?: string | null;
  rMultiple?: number | null;
  publishedAt?: string | null;
  upstream?: Record<string, Record<string, unknown>> | null;
};

export type ExecOrder = {
  id: number;
  requestId: string;
  executionId: string;
  accountId: string;
  purpose: string;
  symbol: string;
  orderType: string;
  volume: number | null;
  requestedPrice: number | null;
  sl: number | null;
  tp: number | null;
  status: string;
  retcode: number | null;
  retcodeText: string | null;
  mt5Order: number | null;
  mt5Deal: number | null;
  fillPrice: number | null;
  fillVolume: number | null;
  spread: number | null;
  slippagePoints: number | null;
  latencyMs: number | null;
  createdAt: string | null;
  completedAt: string | null;
};

export type ExecDeal = {
  accountId: string;
  ticket: number;
  executionId: string | null;
  order: number | null;
  position: number | null;
  symbol: string;
  side: string;
  entry: string;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  fee: number;
  profit: number;
  magic: number | null;
  comment: string | null;
  reason: string | null;
  time: string | null;
};

export type ExecTrade = {
  executionId: string;
  accountId: string;
  accountClass: string;
  currency: string;
  symbol: string;
  direction: string;
  setupKey: string;
  openedAt: string | null;
  closedAt: string | null;
  volume: number;
  entryExpected: number | null;
  entryActual: number | null;
  exitPrice: number | null;
  slippagePoints: number | null;
  realizedPnl: number;
  commission: number;
  swap: number;
  riskAmount: number | null;
  riskPct: number | null;
  rMultiple: number | null;
  durationSec: number | null;
  exitReason: string;
  stage10Status: string;
  publishedAt: string | null;
  setup: { model?: string; trigger?: string; confidence?: number; zone?: string };
};

export type ReconStatus =
  | 'MATCHED'
  | 'MISSING_LOCAL'
  | 'MISSING_BROKER'
  | 'VOLUME_MISMATCH'
  | 'SL_TP_MISMATCH'
  | 'UNKNOWN_EXECUTION'
  | 'UNKNOWN_OUTCOME'
  | 'DUPLICATE_POSITION'
  | 'EXTERNAL_POSITION';

export type ReconFinding = {
  id: number;
  itemKey: string;
  accountId: string;
  executionId: string | null;
  ticket: number | null;
  status: ReconStatus;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  detail: string;
  action: string | null;
  occurrences: number;
  firstSeen: string | null;
  lastSeen: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  note: string | null;
};

export type ExecEvent = {
  id: number;
  executionId: string | null;
  accountId: string | null;
  kind: string;
  state: string | null;
  detail: string;
  data: unknown;
  createdAt: string | null;
};

export type BrokerPosition = {
  ticket: number;
  identifier?: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  swap: number;
  magic: number;
  comment: string;
  time: number | null;
  accountId?: string | null;
};

export type StoredPosition = {
  id: string;
  accountId: string;
  cacsmsTradeId: string | null;
  mt5PositionId: string | null;
  symbol: string;
  side: string;
  volume: number;
  entry: number;
  current: number | null;
  sl: number | null;
  tp: number | null;
  pnl: number;
  currency: string | null;
  status: string;
  openedAt: string | null;
};

export type ControlState = {
  state: ControlStateName;
  flags: { state: ControlStateName; reason: string }[];
  newEntries: boolean;
  management: boolean;
  reason: string;
};

export type ControlSettings = {
  executionEnabled: boolean;
  emergencyStop: boolean;
  emergencyReason?: string | null;
  analysisPaused?: boolean;
  analysisReason?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  reason?: string | null;
};

export type ExecutionRun = {
  status: 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED' | 'STARTING';
  message: string;
  runAt: string | null;
  runs: number;
  errors: number;
  lastError?: string;
  node: string;
  control?: ControlState;
  controlSettings?: ControlSettings;
  auto?: boolean;
  reconciled?: boolean;
  connected?: boolean;
  terminal?: {
    login: string;
    server: string;
    company?: string;
    currency: string;
    balance: number;
    equity: number;
    freeMargin: number;
    marginLevel: number | null;
    leverage: number;
    tradeAllowed: boolean;
    tradeExpert: boolean;
    algoTrading: boolean;
    pingMs: number;
    accountId: string | null;
  } | null;
  summary?: {
    openPnl: number;
    currency: string | null;
    openRiskMoney: number;
    openRiskPct: number | null;
    unknownRisk: number;
    positions: number;
    stage9Positions: number;
    externalPositions: number;
    queue: number;
    waiting: number;
    findingsOpen: number;
    findingsBlocking: number;
  };
  external?: BrokerPosition[];
  waiting?: { executionId: string; accountId: string; blocker: string; reason: string }[];
  triggers?: string[];
  configErrors?: string[] | null;
};

export type ExecutionConfig = Record<string, number | boolean>;

export type ExecutionStateResponse = {
  ok: boolean;
  run: ExecutionRun | null;
  ledger: Execution[];
  pendingAuthorizations: Execution[];
  orders: ExecOrder[];
  deals: ExecDeal[];
  trades: ExecTrade[];
  reconciliation: { open: ReconFinding[]; recent: ReconFinding[] };
  /** Last broker positions mirrored by the engine into dbo.mt5_positions — shown as STALE while MT5 is disconnected. */
  storedPositions: StoredPosition[];
  config: ExecutionConfig;
  overrides: ExecutionConfig;
  defaults: ExecutionConfig;
  bounds: Record<string, [number, number]>;
  control: ControlSettings;
  tradingEnabled: boolean;
  events: ExecEvent[];
};

export type ExecutionDetail = {
  ok: boolean;
  executionId: string;
  execution: Execution | null;
  authorization: Authorization | null;
  events: ExecEvent[];
  orders: ExecOrder[];
  deals: ExecDeal[];
  reconciliation: ReconFinding[];
  trade: (ExecTrade & { evidence?: unknown; timeline?: unknown }) | null;
};
