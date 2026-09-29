/** Channel Analysis contract — mirrors bridge/mt5/channel_analysis.py and GET /channels/snapshot. */
export type ChannelTimeframe = 'Y' | 'Q' | 'MN' | 'W' | 'D1' | 'H8' | 'H1';
export type ChannelDirection = 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNKNOWN';
export type ChannelStatus = 'NO_CHANNEL' | 'FORMING' | 'ACTIVE' | 'WEAKENING' | 'BROKEN' | 'RETESTING' | 'INVALIDATED';
export type ChannelRelationship =
  | 'PRIMARY'
  | 'ALIGNED'
  | 'CORRECTIVE'
  | 'COUNTER_CORRECTION'
  | 'NESTED_CORRECTION'
  | 'REVERSAL_CANDIDATE'
  | 'BREAKOUT'
  | 'RANGE_INTERNAL'
  | 'UNRESOLVED';
export type MarketState =
  | 'UNKNOWN'
  | 'REVERSAL_CANDIDATE'
  | 'BREAKOUT'
  | 'NESTED_CORRECTION'
  | 'COUNTER_CORRECTION'
  | 'CORRECTION'
  | 'CONSOLIDATION'
  | 'CONTINUATION';
export type DataStatus = 'READY' | 'STALE' | 'WARMING_UP' | 'BLOCKED';
export type SourceHealth = 'CONNECTED' | 'DISCONNECTED' | 'STALE';
export type EngineState = 'RUNNING' | 'PAUSED' | 'DEGRADED' | 'ERROR';
export type TouchRole = 'ANCHOR' | 'CANDIDATE' | 'VALIDATION' | 'CONFIRMATION' | 'OPPOSITE';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  complete: boolean;
}
export interface ChannelLinePoint {
  time: number;
  upper: number;
  lower: number;
  mid: number;
}
export interface SwingPoint {
  id: string;
  time: number;
  price: number;
  kind: 'HIGH' | 'LOW';
  strength: number | null;
  confirmed: boolean;
}
export interface ChannelTouch {
  id: string;
  ordinal: number;
  label: string;
  boundary: 'UPPER' | 'LOWER';
  role: TouchRole;
  time: number;
  price: number;
  line: number;
  deviationAtr: number;
  distanceAtr: number;
  quality: number;
}
export interface StructureEvent {
  id: string;
  time: number;
  kind: 'BOS' | 'CHOCH' | 'BREAKOUT' | 'RETEST' | 'FAILED_BREAKOUT' | 'TOUCH' | 'INVALIDATION' | 'VALIDATION' | string;
  direction?: ChannelDirection;
  price: number | null;
  label: string;
}
export interface PricePoint {
  time: number;
  price: number;
}
export interface ChannelGeometry {
  anchorSide: string;
  anchor: PricePoint;
  candidate: PricePoint;
  validation: PricePoint | null;
  lineDefinedBy: PricePoint[];
  slopePerBar: number;
  slopeAtr20: number;
  rise: boolean;
  width: number;
  widthAtr: number;
  parallelismError: number | null;
  parallelOk: boolean;
  touchQuality: number;
  fitScore: number;
  violations: number;
  violationShare: number;
  ageBars: number;
  spanBars: number;
  upperNext: number;
  lowerNext: number;
}
export interface ScoringItem {
  factor: string;
  value: string;
  points: number;
  max: number;
  detail: string;
}
export interface ChannelEvidence {
  candles: number;
  closedCandles: number;
  atr: number;
  swings: SwingPoint[];
  touches: ChannelTouch[];
  events: StructureEvent[];
  structure: unknown[];
  geometry: ChannelGeometry | null;
  reasons: string[];
  warnings: string[];
}
export interface ChannelBreakout {
  side: 'UP' | 'DOWN';
  time: number;
  retestTime: number | null;
  invalidTime: number | null;
  [key: string]: unknown;
}
export interface ChannelLifecycleTimes {
  anchorTime?: number;
  validatedTime?: number | null;
  breakoutTime?: number | null;
  retestTime?: number | null;
  invalidatedTime?: number | null;
}
export interface LiveView {
  currentPrice: number;
  position?: number | null;
  liveUpper?: number;
  liveLower?: number;
  liveMid?: number;
  distanceUpperAtr?: number | null;
  distanceLowerAtr?: number | null;
}
export interface ChannelSnapshot {
  instrument: string;
  timeframe: ChannelTimeframe;
  label: string;
  sourceTimeframe: string;
  direction: ChannelDirection;
  trend: ChannelDirection | null;
  strength: string | null;
  status: ChannelStatus;
  phase: string;
  relationship: ChannelRelationship;
  relationshipReason?: string;
  relationshipVia?: ChannelTimeframe | null;
  correctionDepth?: number | null;
  confidence: number;
  position: number | null;
  currentPrice: number | null;
  upperBoundary: number | null;
  midline: number | null;
  lowerBoundary: number | null;
  distanceUpperAtr: number | null;
  distanceLowerAtr: number | null;
  slope: number | null;
  touchCount: number;
  anchorTouches: number;
  oppositeTouches: number;
  freshnessSeconds: number | null;
  lastCandleTime: number | null;
  lastCandleClose: number | null;
  analysedAt: number;
  channelId: string | null;
  parentTimeframe: ChannelTimeframe | null;
  parentChannelId: string | null;
  dataStatus: DataStatus;
  dataReason: string;
  bars: number;
  requiredBars: number;
  reason: string;
  digits: number;
  configVersion: string;
  ageBars: number | null;
  breakout: ChannelBreakout | null;
  invalidation: string[];
  scoring: ScoringItem[];
  lifecycle: ChannelLifecycleTimes;
  evidence: ChannelEvidence;
  pendingRecalculation: boolean;
  live: LiveView | null;
  candles: Candle[];
  lines: ChannelLinePoint[];
}
export interface HierarchyEdge {
  parent: ChannelTimeframe;
  child: ChannelTimeframe;
  via: ChannelTimeframe | null;
  relationship: ChannelRelationship;
  confidence: number;
  explanation: string;
}
export interface KeyLevel {
  timeframe: ChannelTimeframe;
  kind: 'UPPER' | 'MID' | 'LOWER';
  price: number;
  distanceAtr: number | null;
}
export interface StructureInterpretation {
  primaryDirection: ChannelDirection;
  intermediateDirection: ChannelDirection;
  currentDirection: ChannelDirection;
  parentTimeframe: ChannelTimeframe | null;
  parentDirection: ChannelDirection;
  currentTimeframe: ChannelTimeframe | null;
  currentLegDirection: ChannelDirection;
  marketState: MarketState;
  structuralConfidence: number;
  alignmentScore: number;
  correctionDepth: 'NONE' | 'SHALLOW' | 'MODERATE' | 'DEEP' | 'UNKNOWN';
  correctionRetracement: number | null;
  keySupport: number[];
  keyResistance: number[];
  keyLevels: KeyLevel[];
  validTimeframes: ChannelTimeframe[];
  unresolvedTimeframes: ChannelTimeframe[];
  narrative: string;
}
export interface LifecycleRecord {
  channelId: string;
  anchorSide: string | null;
  anchorTs: number | null;
  direction: ChannelDirection;
  firstStatus: ChannelStatus;
  lastStatus: ChannelStatus;
  validatedTs: number | null;
  brokenTs: number | null;
  invalidatedTs: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  replacedAt: string | null;
}
export interface InstrumentChannelState {
  instrument: string;
  price: number | null;
  priceSource: 'LIVE' | 'LAST_H1_CLOSE';
  liveAt: number | null;
  digits: number;
  analysedAt: number;
  freshnessSeconds: number | null;
  sourceHealth: SourceHealth;
  runId: number;
  stateVersion: string;
  trigger: string | null;
  channels: Record<ChannelTimeframe, ChannelSnapshot>;
  hierarchy: HierarchyEdge[];
  interpretation: StructureInterpretation;
  lifecycle: Partial<Record<ChannelTimeframe, LifecycleRecord[]>>;
}
export interface ChannelUniverseItem {
  symbol: string;
  assetClass: 'FX' | 'METAL';
  enabled: boolean;
  analysed: boolean;
  validChannels: number;
  availableTimeframes: ChannelTimeframe[];
}
export interface ChannelAnalysisEvent {
  id: number;
  symbol: string;
  timeframe: ChannelTimeframe;
  channelId: string;
  type: string;
  ts: number;
  price: number | null;
  severity: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  detail: string;
  createdAt: string | null;
}
export interface ChannelServiceMeta {
  status?: string;
  message?: string;
  runAt?: string;
  runs?: number;
  errors?: number;
  lastError?: string;
  configVersion?: string;
  durationMs?: number;
}
export interface ChannelAnalysisSnapshot {
  ok: boolean;
  generatedAt: number;
  health: 'CONNECTED' | 'DISCONNECTED';
  engineState: EngineState;
  universe: ChannelUniverseItem[];
  service: ChannelServiceMeta;
  selected: InstrumentChannelState | null;
  events: ChannelAnalysisEvent[];
  latencyMs?: number;
  message?: string;
}
