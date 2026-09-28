/** Operational health of a stage engine: is the engine itself running correctly? */
export type OperationalHealth = 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'OFFLINE';

/** Pipeline state: where the stage's work stands for the current market (independent of engine health). */
export type PipelineState = 'IDLE' | 'RUNNING' | 'READY' | 'WAITING' | 'WARMING_UP' | 'BLOCKED' | 'STALE' | 'INVALIDATED' | 'PAUSED';

/** How current a piece of evidence is. LAST_KNOWN = the source is healthy but the live path is blocked upstream. */
export type EvidenceFreshness = 'LIVE' | 'LAST_KNOWN' | 'STALE' | 'NONE';

export type EngineMode = 'SIMULATION' | 'DEMO' | 'LIVE' | 'PROP';

export type EventClass = 'TRACE' | 'INFO' | 'DECISION' | 'WARNING' | 'CRITICAL' | 'EXECUTION';

export type EventTag =
  | 'PROMOTION'
  | 'DEMOTION'
  | 'REJECTION'
  | 'INVALIDATION'
  | 'RISK_VETO'
  | 'H1_CONFIRM'
  | 'AUTHORIZATION'
  | 'MT5_SUBMIT'
  | 'FILL'
  | 'BROKER_REJECT'
  | 'EXIT'
  | 'CONTROL';

export interface StageDependency {
  id: number;
  name: string;
  ok: boolean;
  detail: string;
}

export interface StageCounts {
  processed: number;
  passed: number;
  blocked: number;
  failed: number;
}

export interface StageSla {
  latencyMs: number | null;
  freshnessSec: number | null;
  latencyOk: boolean | null;
  freshnessOk: boolean | null;
  note: string;
}

export interface StageRuntime {
  id: number;
  name: string;
  description: string;
  health: OperationalHealth;
  healthReason: string;
  state: PipelineState;
  stateReason: string;
  /** First upstream stage whose output this stage cannot use; propagated down the pipeline. */
  blockedBy: StageDependency | null;
  confidence: number | null;
  latencyMs: number | null;
  latencyLabel: string;
  latencyHistory: number[];
  freshnessSec: number | null;
  sla: StageSla;
  counts: StageCounts;
  input: string[];
  output: string[];
  dependencies: StageDependency[];
  triggers: string[];
  invalidation: string[];
  activity: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  message: string;
  runs: number | null;
  errors: number | null;
  running: boolean;
  rerun: { allowed: boolean; reason: string };
}

export interface TraceField {
  value: string;
  freshness: EvidenceFreshness;
  source: string;
  at: string | null;
  detail: string;
}

export type TraceDecision = 'WAIT' | 'READY' | 'BLOCKED' | 'OPEN' | 'REJECTED' | 'INVALIDATED';
export type TraceDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface InstrumentTrace {
  symbol: string;
  assetClass: 'FX' | 'METAL';
  /** Stage the instrument is currently held at on the live path (1–10). */
  currentGate: number;
  gateName: string;
  /** Consecutive gates passed from Stage 1 on the live path. */
  stagesPassed: number;
  /** Deepest stage with a positive result regardless of upstream gates (last-known analysis). */
  analysisDepth: number;
  state: PipelineState;
  decision: TraceDecision;
  direction: TraceDirection;
  confidence: number | null;
  confidenceSource: string;
  blocker: string;
  waitingFor: string;
  nextAction: string;
  liveEligible: boolean;
  macro: TraceField;
  regime: TraceField;
  d1: TraceField;
  h8: TraceField;
  h1: TraceField;
  risk: TraceField;
  /** Dominant trend, current leg and trade type when Stage 6 has classified them. */
  legLine?: string;
  updatedAt: string | null;
  since: string | null;
  ageSec: number | null;
}

export interface DecisionQueueItem {
  symbol: string;
  stage: number;
  stageName: string;
  state: PipelineState;
  decision: TraceDecision;
  direction: TraceDirection;
  confidence: number | null;
  waitingFor: string;
  since: string | null;
  ageSec: number | null;
  nextAction: string;
  /** false when the live path is blocked upstream and the row reflects last-known analysis only. */
  live: boolean;
}

export interface WorldTile {
  key: string;
  label: string;
  stage: number;
  value: string;
  sub: string;
  updatedAt: string | null;
  freshness: EvidenceFreshness;
  evidence: string[];
}

export interface WorldModelRecord {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  decision: TraceDecision;
  confidence: number | null;
  tiles: WorldTile[];
}

export interface WorkflowEvent {
  id: string;
  time: string;
  cls: EventClass;
  tag: EventTag | null;
  stage: number;
  symbol?: string;
  event: string;
  detail: string;
  source: string;
}

export interface OrchestratorIndicator {
  key: string;
  label: string;
  status: 'OK' | 'GATED' | 'WARN' | 'FAIL' | 'PAUSED';
  detail: string;
}

export interface AccountView {
  id: string;
  name: string;
  accountClass: string;
  currency: string;
  connection: string;
  tradingMode: string;
  tradingEnabled: boolean;
  eligibility: string;
  issues: string[];
  equity: number | null;
  attached: boolean;
}

export interface EngineRuntime {
  bridgeReachable: boolean;
  mode: EngineMode;
  modeSource: string;
  analysisPaused: boolean;
  tradingEnabled: boolean;
  executionEnabled: boolean;
  emergencyStop: boolean;
  newEntries: boolean;
  management: boolean;
  control: string;
  controlReason: string;
  controlFlags: { state: string; reason: string }[];
  cycle: number | null;
  node: string | null;
  lastHeartbeat: string | null;
  heartbeatAgeSec: number | null;
  activeJobs: string[];
  queuedJobs: number;
  queuedAuthorizations: number;
  retries: number;
  failedJobs: number;
  /** Stages whose engine is currently in ERROR or OFFLINE. */
  engineErrors: number;
  /** Cumulative errors reported by the stage services since the bridge started. */
  serviceErrors: number;
  throughput: number;
  lastEventAt: string | null;
  indicators: OrchestratorIndicator[];
  accounts: AccountView[];
  controlUpdatedAt: string | null;
  controlUpdatedBy: string | null;
}

export interface WorkflowKpis {
  monitored: number;
  liveEligible: number;
  blockedInstruments: number;
  waitingInstruments: number;
  readyCandidates: number;
  openPositions: number;
  engineErrors: number;
  degradedStages: number;
}

export interface WorkflowSnapshot {
  generatedAt: string;
  stages: StageRuntime[];
  instruments: InstrumentTrace[];
  queue: DecisionQueueItem[];
  events: WorkflowEvent[];
  world: WorldModelRecord[];
  engine: EngineRuntime;
  kpis: WorkflowKpis;
}

export type ControlCommand = 'PAUSE_NEW_TRADES' | 'RESUME_NEW_TRADES' | 'PAUSE_ANALYSIS' | 'RESUME_ANALYSIS' | 'EMERGENCY_STOP' | 'RELEASE_EMERGENCY' | 'ENABLE_EXECUTION' | 'DISABLE_EXECUTION';

export interface ActionResult {
  ok: boolean;
  message: string;
}
