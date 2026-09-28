import type { ScoreComponent } from '../structural-direction/types';

export type H1State =
  | 'WAITING_FOR_STAGE6'
  | 'WARMING_UP'
  | 'MONITORING'
  | 'PULLBACK'
  | 'SETUP_FORMING'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'INVALIDATED'
  | 'STALE'
  | 'BLOCKED';

export type GateStatus = 'PASS' | 'WAIT' | 'FAIL' | 'STALE' | 'N/A';
export type GateKey =
  | 'htf'
  | 'structure'
  | 'location'
  | 'freshness'
  | 'h1Structure'
  | 'pullback'
  | 'bos'
  | 'choch'
  | 'momentum'
  | 'retest'
  | 'invalidation'
  | 'score';

export type Gate = { key: GateKey; label: string; status: GateStatus; detail: string; mandatory: boolean; ts: number | null };

export type H1Phase = 'FALSE_BREAKOUT' | 'RETEST' | 'BREAKOUT' | 'PULLBACK' | 'IMPULSE' | 'CONSOLIDATION' | 'TRENDING' | 'COUNTER_MOVE';

export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL' | 'H' | 'L';
export type H1Swing = { ts: number; kind: 'H' | 'L'; price: number; label: SwingLabel; confirmTs: number };
export type H1Event = { type: 'BOS' | 'CHOCH'; side: 'UP' | 'DOWN'; ts: number; level: number; swingTs: number; swingLabel?: SwingLabel; price: number };
export type PricePoint = { ts: number; price: number };

export type H1Setup = {
  model: 'PULLBACK_CONTINUATION' | 'BREAKOUT_RETEST';
  pullback: 'NONE' | 'SHALLOW' | 'IN_PROGRESS' | 'HOLDING' | 'COMPLETE';
  depth: number | null;
  peak: (H1Swing & { confirmI?: number }) | null;
  origin: H1Swing | null;
  extreme: PricePoint | null;
  fib: { f382: number; f618: number; f786: number } | null;
  trigger: H1Event | null;
  triggerAgeBars: number | null;
  retest: (PricePoint & { level: number }) | null;
  falseBreakout: (PricePoint & { level: number }) | null;
  counterAfterTrigger: H1Event | null;
  invalidation: number | null;
  invalidated: boolean;
  riskAtr: number | null;
};

export type H1Structure = {
  bars: number;
  atr: number;
  lastTs: number;
  lastClose: number;
  bias: -1 | 0 | 1;
  trend: 'BULLISH' | 'BEARISH' | 'RANGE';
  mom5: number;
  momPrev: number;
  volRatio: number;
  volState: 'EXPANDING' | 'CONTRACTING' | 'NORMAL';
  range12Atr: number;
  activeHigh: number | null;
  activeLow: number | null;
  swings: H1Swing[];
  events: H1Event[];
};

export type Stage6Context = {
  state: string;
  direction: string;
  expectedDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasonCode: string | null;
  reason: string;
  phase: string | null;
  alignment: string;
  confidence: number;
  zone: string | null;
  positionD1: number | null;
  positionH8: number | null;
  price: number | null;
  d1: { status: string | null; direction: string; confirmed: boolean } | null;
  h8: { status: string | null; direction: string; confirmed: boolean } | null;
  freshness: string | null;
  readySince: string | null;
  invalidation: string[];
};

export type Stage8Handoff = {
  instrument: string;
  direction: 'BULLISH' | 'BEARISH';
  structuralDirection: string;
  entryContext: {
    model: H1Setup['model'];
    trigger: 'BOS' | 'CHOCH';
    triggerTs: number;
    triggerLevel: number;
    pullbackExtreme: number | null;
    pullbackDepth: number | null;
    lastClose: number;
    retest: H1Setup['retest'];
  };
  h1Structure: { bias: number; trend: string; phase: H1Phase; momentum: number; volState: string };
  evidence: { bos: Gate; choch: Gate; components: ScoreComponent[] };
  channelLocation: { zone: string | null; d1: number | null; h8: number | null };
  confidence: number;
  invalidationLevel: number | null;
  riskAtr: number | null;
  freshness: string;
  h1LastTs: number;
  reasoning: string[];
  executes: false;
  confirmedSince?: string | null;
};

/** Stage 7 decision persisted in dbo.app_h1_instrument.decision_json. */
export type H1Decision = {
  symbol: string;
  state: H1State;
  direction: string;
  expectedDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasonCode: string | null;
  reason: string;
  explanation: string;
  phase: H1Phase | null;
  score: number;
  components: ScoreComponent[];
  gates: Record<GateKey, Gate>;
  reasoning: string[];
  h1: H1Structure | null;
  setup: H1Setup | null;
  invalidationLevel: number | null;
  confirmed: boolean;
  handoff: Stage8Handoff | null;
  stage6: Stage6Context | null;
  data: { status: string; reason: string; available: number; required: number; latestTs: number | null } | null;
  live: { price: number; at: number | null; event: 'BOS_ATTEMPT' | 'INVALIDATION_BREACH' | null; breakLevel: number | null; invalidationLevel: number | null; note: string | null } | null;
  executes: false;
  tradeType?: string | null;
  marketLeg?: {
    dominantTrend: string;
    currentLeg: string;
    ltfTrend: string;
    tradeType: string;
    reversalState: string;
    expectedDestination: string | null;
    reasonCode: string;
    reason: string;
  };
  confirmedSince?: string | null;
  changedAt?: string | null;
  evaluatedAt?: string | null;
  trigger?: string | null;
};

export type H1Counters = {
  universe: number;
  candidates: number;
  monitoring: number;
  confirmed: number;
  rejected: number;
  invalidated: number;
  blocked: number;
  byState: Record<H1State, number>;
};

export type H1RunMeta = {
  status: 'STARTING' | 'HEALTHY' | 'DEGRADED';
  message: string;
  runAt?: string;
  durationMs?: number;
  triggers?: string[];
  runs?: number;
  errors?: number;
  lastError?: string;
  changed?: number;
  counters?: H1Counters;
  confirmedNow?: string[];
  candidates?: string[];
  changes?: { symbol: string; from: H1State | null; to: H1State }[];
  upstream?: { directionRunAt: string | null; directionStatus: string | null; ready: number };
  live?: string[];
  config?: { engine: Record<string, number>; service: { loopSec: number; fullEverySec: number; staleRunSec: number } };
};

export type H1HistoryRow = {
  id: number;
  symbol: string;
  state: H1State;
  direction: string;
  reasonCode: string;
  phase: H1Phase | null;
  score: number;
  invalidationLevel: number | null;
  stage6State: string | null;
  prevState: H1State | null;
  trigger: string | null;
  explanation: string;
  createdAt: string;
};

export type H1EventRow = {
  id: number;
  symbol: string;
  type: 'BOS' | 'CHOCH' | 'PULLBACK_COMPLETE' | 'RETEST' | 'FALSE_BREAKOUT' | 'INVALIDATION' | 'CONFIRMED';
  side: 'UP' | 'DOWN';
  ts: number;
  level: number | null;
  price: number | null;
  detail: string | null;
  createdAt: string;
};

export type H1Run = {
  id: number;
  runAt: string;
  triggers: string;
  status: string;
  candidates: number;
  monitoring: number;
  confirmed: number;
  rejected: number;
  invalidated: number;
  blocked: number;
  changed: number;
  durationMs: number;
};

export type H1ConfirmState = {
  ok: boolean;
  run: H1RunMeta | null;
  service?: Partial<H1RunMeta>;
  instruments: H1Decision[];
  history: H1HistoryRow[];
  events: H1EventRow[];
  runs: H1Run[];
};

export type H1Detail = { ok: boolean; symbol: string; instrument: H1Decision | null; history: H1HistoryRow[]; events: H1EventRow[] };

export type H1ChartChannel = { timeframe: 'D1' | 'H8'; lines: { ts: number; lower: number; upper: number; projected: boolean }[]; status: string | null; direction: string | null };

export type H1Chart = {
  ok: boolean;
  symbol: string;
  candles: { ts: number; open: number; high: number; low: number; close: number }[];
  swings: H1Swing[];
  events: H1Event[];
  channels: H1ChartChannel[];
  live: { price: number; bid: number; ask: number; time: number | null } | null;
  decision: H1Decision | null;
};
