export type Direction = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED';
export type Status =
  | 'WATCHING'
  | 'SETUP_DEVELOPING'
  | 'NEAR_CONFIRMATION'
  | 'CONFIRMATION_PENDING'
  | 'CONFIRMED'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'NO_OPPORTUNITY';
export type TF = 'YTD' | 'Q' | 'MN' | 'W' | 'D1' | 'H8' | 'H1' | 'M15' | 'M5';

export interface TFState {
  tf: TF;
  direction: Direction;
  short: string;
  structure: string;
  confidence: number;
  summary: string;
}

export interface EvidenceRow {
  kind: 'support' | 'conflict' | 'missing';
  title: string;
  detail: string;
  tf: TF;
}

export interface Step {
  label: string;
  state: 'done' | 'active' | 'pending' | 'blocked';
  detail: string;
}

export interface PathStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AnalysisView {
  id: string;
  symbol: string;
  created: string;
  updated: string;
  direction: Direction;
  status: Status;
  opportunity: string;
  confidence: number;
  primaryTf: TF;
  entryTf: TF;
  marketState: string;
  thesis: string;
  thesisBrief: string;
  thesisTitle: string;
  priceLocationDetail: string;
  chartLines: { time: number; upper: number; lower: number; mid: number }[];
  invalidation: string;
  target: string;
  engineState: string;
  agreement: string;
  p1State: string;
  p2State: string;
  tradable: boolean;
  priceLocation: string;
  supertrendLabel: string;
  htfAlignment: string[];
  tfs: TFState[];
  evidence: EvidenceRow[];
  evidenceCounts: { support: number; conflict: number; missing: number };
  evidenceExtra: { support: number; conflict: number; missing: number };
  rawEvidence: EvidenceRow[];
  pathSteps: PathStep[];
  structureLabel: string;
  steps: Step[];
  candles: ChartCandle[];
  markers: ChartMarker[];
  timeline: { time: string; title: string; detail: string }[];
}
