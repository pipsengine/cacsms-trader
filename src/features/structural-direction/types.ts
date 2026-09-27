import type { Breakout, ChannelStatus, DataStatus, MarketPhase, VisionDirection } from '../htf-vision/types';

export type StructuralDirection = VisionDirection;
export type ProcessingState = 'WAITING' | 'ANALYSING' | 'ALIGNED' | 'CONFLICT' | 'BLOCKED' | 'STALE' | 'INVALIDATED' | 'READY_FOR_H1';
export type TfAlignment = 'ALIGNED' | 'PULLBACK' | 'D1_ONLY' | 'CONFLICT' | 'UNCONFIRMED';
export type StructuralPhase = MarketPhase | 'REVERSAL';
export type PositionZone = 'VALUE' | 'MID' | 'EXTENDED' | 'BEYOND_SUPPORT' | 'BEYOND_EXTENSION' | 'UNKNOWN';

/** Exact upstream / structural reason codes published by the bridge engine. */
export type ReasonCode =
  | 'WAITING_FOR_SCANNER'
  | 'NOT_PROMOTED_BY_SCANNER'
  | 'WAITING_FOR_HTF_VISION'
  | 'DATA_BLOCKED'
  | 'INSUFFICIENT_D1_HISTORY'
  | 'INSUFFICIENT_H8_HISTORY'
  | 'STALE_DATA'
  | 'CHANNEL_NOT_VALIDATED'
  | 'NEUTRAL_STRUCTURE'
  | 'D1_CHANNEL_INVALIDATED'
  | 'STRUCTURAL_REVERSAL'
  | 'H8_REVERSAL_AGAINST_D1'
  | 'SCANNER_STRUCTURE_CONFLICT'
  | 'D1_DETERIORATING'
  | 'PRICE_BEYOND_D1_SUPPORT'
  | 'AWAITING_PULLBACK'
  | 'LOW_STRUCTURAL_CONFIDENCE'
  | 'READY_PULLBACK'
  | 'READY_RETEST'
  | 'READY_BREAKOUT'
  | 'READY_REVERSAL'
  | 'READY_CONTINUATION';

export type ScoreComponent = { key: string; label: string; points: number; max: number; detail: string };

export type UpstreamLeg = {
  asset: string;
  composite: number | null;
  macro: number | null;
  current: number | null;
  momentum: number | null;
  regime: string | null;
  group: string | null;
  confidence: number | null;
  persistence: number | null;
  trajectory: string | null;
  date: string | null;
};

export type ScannerUpstream = {
  state: string;
  promoted: boolean;
  promotedAt: string | null;
  direction: string;
  conviction: number | null;
  confidence: number | null;
  differential: number | null;
  macroBias: string | null;
  relationship: string | null;
  alignment: string | null;
  trajectory: string | null;
  acceleration: string | null;
  persistence: number | null;
  reason: string;
  rank: number | null;
  freshness: string | null;
  freshnessReason: string | null;
  updatedAt: string | null;
  base: UpstreamLeg | null;
  quote: UpstreamLeg | null;
};

export type VisionUpstream = {
  status: DataStatus;
  reason: string;
  primaryDirection: VisionDirection;
  agreement: string;
  phase: MarketPhase | null;
  confidence: number;
  qualified: boolean;
  analysedAt: string | null;
  trigger: string | null;
};

export type TfEvidence = {
  dataStatus: DataStatus | null;
  dataReason: string | null;
  status: ChannelStatus | null;
  direction: VisionDirection;
  lean: VisionDirection | null;
  confirmed: boolean;
  phase: MarketPhase | null;
  position: number | null;
  confidence: number;
  channelKey: string | null;
  lastTs: number | null;
  breakout: Breakout | null;
  touches: { anchor: number; opposite: number; total: number } | null;
  available: number | null;
  required: number | null;
  reason: string | null;
};

export type Stage7Handoff = {
  instrument: string;
  expectedDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  direction: StructuralDirection;
  d1: Pick<TfEvidence, 'status' | 'direction' | 'phase' | 'confidence' | 'position'>;
  h8: Pick<TfEvidence, 'status' | 'direction' | 'phase' | 'confidence' | 'position'>;
  phase: StructuralPhase;
  alignment: TfAlignment;
  reasonCode: ReasonCode;
  channelPosition: number | null;
  zone: PositionZone;
  confidence: number;
  evidence: ScoreComponent[];
  freshness: string;
  invalidation: string[];
  executes: false;
  readySince?: string | null;
};

/** Stage 6 decision persisted in dbo.app_direction_instrument.decision_json. */
export type DirectionDecision = {
  symbol: string;
  state: ProcessingState;
  direction: StructuralDirection;
  expectedDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasonCode: ReasonCode | null;
  reason: string;
  explanation: string;
  structuralPhase: StructuralPhase | null;
  alignment: TfAlignment;
  confidence: number;
  components: ScoreComponent[];
  conflicts: string[];
  invalidation: string[];
  readyForH1: boolean;
  handoff: Stage7Handoff | null;
  upstream: { scanner: ScannerUpstream | null; vision: VisionUpstream | null };
  d1: TfEvidence;
  h8: TfEvidence;
  position: { d1: number | null; h8: number | null; source: 'LIVE' | 'CLOSE'; price: number | null; marketOpen: boolean | null; at: string | null };
  zone: { name: PositionZone; relative: number | null };
  freshness: {
    status: 'CURRENT' | 'STALE' | 'UNKNOWN';
    reason: string;
    visionRunAt: string | null;
    visionRunAgeSec: number | null;
    visionAnalysedAt: string | null;
    scanner: string | null;
    d1LastTs: number | null;
    h8LastTs: number | null;
  };
  executes: false;
  readySince?: string | null;
  changedAt?: string | null;
  evaluatedAt?: string | null;
  trigger?: string | null;
};

export type DirectionCounters = {
  universe: number;
  candidates: number;
  analysed: number;
  aligned: number;
  pullbackWaiting: number;
  conflicts: number;
  blocked: number;
  ready: number;
  stale: number;
  invalidated: number;
  byState: Record<ProcessingState, number>;
  byDirection: Record<StructuralDirection, number>;
};

export type DirectionRunMeta = {
  status: 'STARTING' | 'HEALTHY' | 'DEGRADED';
  message: string;
  runAt?: string;
  durationMs?: number;
  triggers?: string[];
  runs?: number;
  errors?: number;
  lastError?: string;
  changed?: number;
  counters?: DirectionCounters;
  readyNow?: string[];
  changes?: { symbol: string; from: ProcessingState | null; to: ProcessingState }[];
  upstream?: { scannerRunAt: string | null; scannerStatus: string | null; visionRunAt: string | null; visionStatus: string | null; promoted: number };
  config?: { engine: { readyScore: number; strongScore: number; minD1Confidence: number; valuePct: number; extendedPct: number; staleRunSec: number; diffFull: number; weights: Record<string, number> }; service: { loopSec: number; fullEverySec: number; materialStrength: number } };
};

export type DirectionHistoryRow = {
  id: number;
  symbol: string;
  state: ProcessingState;
  direction: StructuralDirection;
  reasonCode: ReasonCode;
  phase: StructuralPhase | null;
  alignment: TfAlignment;
  confidence: number;
  position: number | null;
  d1: { status: ChannelStatus | null; direction: VisionDirection | null };
  h8: { status: ChannelStatus | null; direction: VisionDirection | null };
  prevState: ProcessingState | null;
  prevDirection: StructuralDirection | null;
  trigger: string | null;
  explanation: string;
  createdAt: string;
};

export type DirectionRun = {
  id: number;
  runAt: string;
  triggers: string;
  status: string;
  candidates: number;
  aligned: number;
  pullbackWaiting: number;
  conflicts: number;
  blocked: number;
  ready: number;
  changed: number;
  durationMs: number;
};

export type DirectionState = {
  ok: boolean;
  run: DirectionRunMeta | null;
  service?: Partial<DirectionRunMeta>;
  instruments: DirectionDecision[];
  history: DirectionHistoryRow[];
  runs: DirectionRun[];
};

export type DirectionDetail = { ok: boolean; symbol: string; instrument: DirectionDecision | null; history: DirectionHistoryRow[] };
