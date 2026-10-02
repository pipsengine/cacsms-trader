export type Direction = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED';
export type Timeframe = 'YTD' | 'Q' | 'MN' | 'W' | 'D1' | 'H8' | 'H1' | 'M15' | 'M5';
export type EvidenceKind = 'SUPPORTING' | 'CONFLICTING' | 'MISSING';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export interface TimeframeState {
  timeframe: Timeframe;
  direction: Direction;
  phase: string;
  regime: string;
  evidenceScore: number | null;
  structure: string;
  lastEvent: string;
  channelPosition: string;
  supertrend: Direction;
  closedAt: string;
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  timeframe: Timeframe;
  label: string;
  detail: string;
  source: string;
  priority: number;
}

export interface Annotation {
  id: string;
  kind: string;
  label: string;
  price: number;
  timeIndex: number;
  tone: 'good' | 'bad' | 'info' | 'neutral';
  priority: number;
}

export interface Scenario {
  id: string;
  name: string;
  direction: Direction;
  status: string;
  conditions: string[];
  invalidation: string;
  path: string[];
}

export interface TradabilityStep {
  id: string;
  label: string;
  detail: string;
  status: 'COMPLETE' | 'ACTIVE' | 'PENDING' | 'FAILED' | 'NOT_REQUIRED';
}

export interface Reconciliation {
  state: 'AGREEMENT' | 'PARTIAL' | 'CONFLICT' | 'INSUFFICIENT_DATA';
  ai: string;
  engine: string;
  difference: string;
}

export interface AnalysisResult {
  analysisId: string;
  revision: number;
  symbol: string;
  displayName: string;
  primaryTimeframe: Timeframe;
  createdAt: string;
  lastClosedAt: string;
  status: string;
  direction: Direction;
  marketState: string;
  structure: string;
  evidenceScore: number;
  thesisTitle: string;
  thesis: string;
  timeframes: TimeframeState[];
  candles: Candle[];
  evidence: Evidence[];
  annotations: Annotation[];
  scenarios: Scenario[];
  tradability: TradabilityStep[];
  reconciliation: Reconciliation;
  priceLocation: string;
  supertrend: Direction;
  htfAlignment: string[];
  expectedPath: { label: string; status: 'done' | 'current' | 'future' }[];
  ohlc: { o: number; h: number; l: number; c: number; change: number; changePct: number };
  levels: {
    erz: [number, number];
    supply: [number, number];
    p2: number;
    invalidation: number;
    t1: number;
    t2: number;
  };
  tradable: boolean;
  p1State: string;
  p2State: string;
  opportunity: string;
  chartLines?: { time: number; upper: number; lower: number; mid: number }[];
  supertrendSeries?: { time: number; value: number; direction: string }[];
  dataQuality?: string;
  regime?: string;
  analyticalTradability?: string;
  opportunityDetail?: {
    available: boolean;
    opportunityId?: string;
    opportunityType?: string;
    direction?: string;
    originTimeframe?: string;
    lifecycle?: string;
    zone?: string;
    distanceToZone?: string | number;
    reactionState?: string;
    breakState?: string;
    retestState?: string;
    invalidation?: string;
    blockingRequirements?: unknown[];
  };
  modeFocus?: string;
  engines?: { engine: string; summary: string; agreement?: string; highlights?: string[] }[];
  contradictions?: string[];
}
