/** Stage 4 Market Scanner contracts (bridge `/scanner/*`, persisted in dbo.app_scanner_*). */

export type ScannerState = 'PROMOTED' | 'QUALIFIED' | 'WATCH' | 'NEUTRAL' | 'BLOCKED' | 'STALE' | 'INSUFFICIENT_DATA';
export type ScannerDirection = 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
export type Stage1Readiness = 'READY' | 'CLOSED' | 'STALE' | 'BLOCKED' | 'INSUFFICIENT_DATA';
export type Relationship = 'STRONG_VS_WEAK' | 'WEAK_VS_STRONG' | 'BASE_LED' | 'QUOTE_LED' | 'SIMILAR' | 'MIXED' | 'WARMING_UP';
export type Alignment = 'ALIGNED' | 'SUPPORTIVE' | 'UNCONFIRMED' | 'SIMILAR' | 'CONFLICTING';

export type AssetLeg = {
  asset: string;
  composite: number;
  macro: number | null;
  current: number | null;
  momentum: number | null;
  acceleration: number | null;
  regime: string | null;
  group: string;
  confidence: number;
  persistence: number;
  durationObs: number;
  trajectory: 'RISING' | 'FALLING' | 'FLAT';
  date: string | null;
};

export type ScoreComponent = { key: string; label: string; points: number; max: number; detail: string };
export type PromotionRule = { key: string; label: string; pass: boolean; detail: string };

export type Stage1Detail = {
  status: Stage1Readiness;
  reason: string;
  marketOpen: boolean;
  quoteValid: boolean;
  tickAgeSec: number | null;
  liveEligible: boolean;
  timeframes: Record<string, { status: string; reason: string; series: string }>;
};

export type Freshness = {
  status: 'CURRENT' | 'STALE' | 'UNKNOWN';
  reason: string;
  obsDate: string | null;
  expectedDate: string | null;
  lagDays: number | null;
};

export type ScannerInstrument = {
  symbol: string;
  rank: number;
  state: ScannerState;
  direction: ScannerDirection;
  conviction: number | null;
  rawScore: number | null;
  confidence: number | null;
  differential: number | null;
  macroDifferential?: number;
  currentDifferential?: number;
  momentumDifferential?: number | null;
  accelerationDifferential?: number | null;
  macroBias?: string;
  trajectory?: 'WIDENING' | 'NARROWING' | 'FLAT';
  acceleration?: 'ACCELERATING' | 'DECELERATING' | 'STEADY';
  relationship: Relationship;
  alignment: Alignment;
  persistence?: number;
  baseAsset: string;
  quoteAsset: string;
  model: 'FIAT' | 'XAU_DEDICATED';
  base: AssetLeg | null;
  quote: AssetLeg | null;
  stage1: Stage1Detail;
  freshness: Freshness;
  components: ScoreComponent[];
  params?: { neutralBand: number; strongDiff: number; diffFull: number };
  reason: string;
  evidence?: string[];
  promotion: { eligible: boolean; promoted: boolean; threshold?: number; rules: PromotionRule[]; reason: string; liveEligible?: boolean };
  promotedAt: string | null;
  runId: number | null;
  updatedAt: string | null;
};

export type ScannerEngineConfig = {
  neutralBand: number;
  strongDiff: number;
  strongConviction: number;
  diffFull: number;
  neutralCap: number;
  weights: Record<string, number>;
  promotion: {
    minConviction: number;
    minConfidence: number;
    minPersistence: number;
    hysteresis: number;
    rejectAlignments: string[];
    promoteWhenMarketClosed: boolean;
  };
  qualifyConviction: number;
  watchConviction: number;
  maxTickAgeSec: number;
  xau: { neutralBand: number; strongDiff: number; diffFull: number };
};

export type ScannerCounters = { universe: number; available: number; directional: number; promoted: number };

export type ScannerRun = {
  status: 'HEALTHY' | 'DEGRADED' | 'STARTING';
  message: string;
  runAt: string;
  triggers: string[];
  runs: number;
  durationMs?: number;
  counters: ScannerCounters;
  byState: Record<ScannerState, number>;
  downstream: { stage5Analysed: number; channelQualified: number; channelQualifiedPromoted: number };
  marketOpen: boolean;
  providerOk: boolean;
  expectedD1: string | null;
  regimeRunAt: string | null;
  regimeStatus: string | null;
  promotedNow: string[];
  changes: { symbol: string; action: 'PROMOTED' | 'DEMOTED' }[];
  snapshot?: boolean;
  snapshotId?: number;
  configError?: string;
  config: {
    engine: ScannerEngineConfig;
    service: { loopSec: number; fullEverySec: number; materialStrength: number };
    overrides: Record<string, number | boolean>;
    tunable: Record<string, [number, number]>;
  };
};

export type ScannerPromotion = {
  id: number;
  symbol: string;
  action: 'PROMOTED' | 'DEMOTED';
  runId: number | null;
  direction: ScannerDirection;
  conviction: number | null;
  differential: number | null;
  relationship: string;
  confidence: number | null;
  freshness: string;
  reason: string;
  evidence: string[];
  createdAt: string;
};

export type ScannerSnapshotRun = {
  id: number;
  runAt: string;
  triggers: string;
  status: string;
  universe: number;
  available: number;
  directional: number;
  promoted: number;
  durationMs: number;
};

export type ScannerStateResponse = {
  ok: boolean;
  run: ScannerRun | null;
  instruments: ScannerInstrument[];
  promotions: ScannerPromotion[];
  snapshots: ScannerSnapshotRun[];
  service?: { status: string; message: string; runAt: string | null; runs: number; errors: number; lastError: string | null };
};

export type ScannerDetail = {
  ok: boolean;
  symbol: string;
  instrument: ScannerInstrument | null;
  promotions: ScannerPromotion[];
  history: {
    runAt: string;
    rank: number;
    state: ScannerState;
    direction: ScannerDirection;
    conviction: number | null;
    differential: number | null;
    stage1: string;
    promoted: boolean;
  }[];
};
