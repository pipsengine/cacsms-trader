export type VisionDirection = 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
export type ChannelStatus = 'FORMING' | 'VALIDATED' | 'ACTIVE' | 'WEAKENING' | 'BROKEN' | 'RETESTING' | 'INVALIDATED' | 'NONE';
export type DataStatus = 'READY' | 'STALE' | 'WARMING_UP' | 'INSUFFICIENT_DATA' | 'BLOCKED';
export type InstrumentStatus = DataStatus;
export type MarketPhase =
  | 'IMPULSE'
  | 'PULLBACK'
  | 'CONSOLIDATION'
  | 'BREAKOUT'
  | 'FAILED_BREAKOUT'
  | 'RETEST'
  | 'REVERSAL_RISK'
  | 'COMPRESSION'
  | 'DETERIORATION';
export type Agreement = 'AGREE' | 'CONFLICT' | 'PARTIAL' | 'NEUTRAL' | 'UNCONFIRMED';
export type VisionTf = 'D1' | 'H8' | 'H1';

export type Breakout = {
  side: 'UP' | 'DOWN';
  ts: number;
  price: number;
  barsSince: number;
  distanceAtr: number;
  maxDistanceAtr: number;
  retestTs: number | null;
  lastRetestTs: number | null;
  retesting: boolean;
  boundary: number;
  invalidTs: number | null;
};

export type Evidence = { tf?: VisionTf; factor: string; value: string; points: number; max: number; detail: string };

export type Touch = {
  seq: number;
  boundary: 'LOWER' | 'UPPER';
  role: 'ANCHOR' | 'CANDIDATE' | 'VALIDATION' | 'CONFIRMATION' | 'OPPOSITE';
  ts: number;
  price: number;
  line: number;
  deviationAtr: number;
};

/** Full timeframe analysis persisted in dbo.app_vision_channel.analysis_json. */
export type TfAnalysis = {
  timeframe: VisionTf;
  bars: number;
  available?: number;
  lastTs: number;
  lastClose: number;
  atr: number;
  atrSlow: number;
  volRatio: number;
  volState: 'EXPANDING' | 'NORMAL' | 'CONTRACTING';
  swings: { highs: number; lows: number };
  status: ChannelStatus;
  direction: VisionDirection;
  lean: VisionDirection;
  confirmed: boolean;
  channelKey?: string;
  anchorSide?: 'LOWER' | 'UPPER';
  anchor?: { ts: number; price: number };
  candidate?: { ts: number; price: number };
  validation?: { ts: number; price: number } | null;
  /** The swing pair whose line defines the anchor boundary (may differ from touches #1/#2). */
  lineDefinedBy?: { ts: number; price: number }[];
  slope?: number;
  slopeAtr20?: number;
  rise?: number;
  width?: number;
  widthAtr?: number;
  upper?: number;
  lower?: number;
  upperNext?: number;
  lowerNext?: number;
  position: number | null;
  touches?: { anchor: number; opposite: number; total: number };
  touchList: Touch[];
  touchQuality?: number;
  parallelDev?: number | null;
  parallelOk?: boolean;
  ageBars?: number;
  spanBars?: number;
  violations?: number;
  violationShare?: number;
  breakout: Breakout | null;
  failedBreakouts: { side: 'UP' | 'DOWN'; ts: number; reentryTs: number }[];
  phase: MarketPhase;
  confidence: number;
  evidence: Evidence[];
  invalidation: string[];
  reason: string;
};

export type TfSummary = {
  dataStatus: DataStatus;
  dataReason: string;
  status: ChannelStatus | null;
  direction: VisionDirection;
  lean?: VisionDirection;
  confirmed: boolean;
  position: number | null;
  phase: MarketPhase | null;
  confidence: number;
  channelKey?: string;
  channelId?: string | null;
  parentChannelId?: string | null;
  relationship?: string | null;
  upper?: number | null;
  lower?: number | null;
  lastTs?: number;
  breakout?: Breakout | null;
  touches?: { anchor: number; opposite: number; total: number };
  available?: number;
  required?: number;
  reason?: string;
};

export type ScannerQualification = {
  qualified: boolean;
  reason: string;
  bias: string | null;
  conviction: number | null;
  differential: number | null;
  /** Stage 4 publication (present when the gate is STAGE4_PROMOTION). */
  relationship?: string | null;
  confidence?: number | null;
  freshness?: string | null;
  state?: string | null;
  evidence?: string[];
  liveEligible?: boolean;
  gate: string;
};

/** Stage 5 → Stage 6 contract (dbo.app_vision_instrument.output_json). */
export type VisionInstrument = {
  symbol: string;
  status: InstrumentStatus;
  reason: string;
  scanner: ScannerQualification;
  primaryDirection: VisionDirection;
  agreement: Agreement;
  phase: MarketPhase | null;
  channelPosition: number | null;
  confidence: number;
  d1: TfSummary;
  h8: TfSummary;
  h1?: TfSummary;
  nested?: {
    parentTimeframe: string;
    parentChannelId?: string | null;
    childTimeframe: string;
    childChannelId?: string | null;
    relationship: string;
    region: string;
    currentLeg: string;
    expectedDestination: string | null;
    h1Status?: string;
    h1Direction?: string | null;
    h1Relationship?: string | null;
    h1ChannelId?: string | null;
    h1Upper?: number | null;
    h1Lower?: number | null;
  };
  observation?: 'ELEVATED' | 'NORMAL' | string;
  invalidation: string[];
  evidence: Evidence[];
  reasoning: string[];
  executes: false;
  /** Latest quote projected onto the forming bar; tickTs is broker tick time in UTC seconds. */
  live?: {
    price: number | null;
    positionD1: number | null;
    positionH8: number | null;
    at: string | null;
    tickTs: number | null;
    marketOpen: boolean | null;
  };
  analysedAt?: string | null;
  trigger?: string | null;
  durationMs?: number | null;
};

export type VisionEvent = {
  id: number;
  symbol: string;
  timeframe: VisionTf;
  channelKey: string;
  type: string;
  ts: number;
  price: number | null;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  detail: string;
  createdAt: string | null;
};

export type VisionRunMeta = {
  status: 'STARTING' | 'HEALTHY' | 'DEGRADED';
  message: string;
  runAt?: string;
  durationMs?: number;
  analysedNow?: number;
  failedNow?: number;
  newEvents?: number;
  triggers?: string[];
  runs?: number;
  errors?: number;
  lastError?: string;
  summary?: {
    analysed: number;
    qualified: number;
    ready: number;
    confirmedD1: number;
    agree: number;
    conflict: number;
    byStatus: Record<InstrumentStatus, number>;
  };
  config?: { engine: Record<string, number>; timeframes: Record<VisionTf, Record<string, number>>; service: Record<string, unknown> };
};

export type VisionState = {
  ok: boolean;
  message?: string;
  run: VisionRunMeta | null;
  service?: Partial<VisionRunMeta>;
  instruments: VisionInstrument[];
  events: VisionEvent[];
};

export type ChannelRecord = {
  analysis: TfAnalysis | null;
  dataStatus: DataStatus;
  dataReason: string;
  available: number;
  required: number;
  analysedAt: string | null;
};

export type VisionHistoryRow = {
  d1BarTs: number;
  h8BarTs: number;
  status: InstrumentStatus;
  primaryDirection: VisionDirection;
  agreement: Agreement;
  phase: MarketPhase | null;
  confidence: number;
  d1: { status: ChannelStatus | null; direction: VisionDirection | null; position: number | null; confidence: number | null };
  h8: { status: ChannelStatus | null; direction: VisionDirection | null; position: number | null; confidence: number | null };
  trigger: string | null;
  analysedAt: string | null;
};

export type VisionDetail = {
  ok: boolean;
  symbol: string;
  instrument: VisionInstrument | null;
  channels: Record<VisionTf, ChannelRecord | null>;
  events: VisionEvent[];
  history: VisionHistoryRow[];
};

export type ChartCandle = { ts: number; open: number; high: number; low: number; close: number };
export type ChartLine = { ts: number; lower: number; upper: number; projected: boolean };
export type ChartSwing = { ts: number; kind: 'H' | 'L'; price: number };

export type VisionChart = {
  ok: boolean;
  symbol: string;
  timeframe: VisionTf;
  candles: ChartCandle[];
  swings: ChartSwing[];
  lines: ChartLine[];
  channel: ChannelRecord | null;
};
