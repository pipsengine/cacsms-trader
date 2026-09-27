export type RegimeName =
  | 'Strengthening'
  | 'Accelerating'
  | 'Persistent'
  | 'Stable'
  | 'Deteriorating'
  | 'Weakening'
  | 'Recovering'
  | 'Reversing';

export const REGIME_NAMES: RegimeName[] = [
  'Strengthening',
  'Accelerating',
  'Persistent',
  'Stable',
  'Deteriorating',
  'Weakening',
  'Recovering',
  'Reversing',
];

export const REGIME_ASSETS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU'] as const;
export type RegimeAsset = (typeof REGIME_ASSETS)[number];

export type RegimeSnapshot = {
  asset: string;
  date: string;
  closed: boolean;
  q: number | null;
  m: number | null;
  w: number | null;
  d: number | null;
  macro: number | null;
  current: number | null;
  composite: number | null;
  previous: number | null;
  momentum: number | null;
  acceleration: number | null;
  rawRegime: RegimeName | null;
  regime: RegimeName | null;
  regimeSince: string | null;
  candidate: RegimeName | null;
  candidateCount: number;
  candidateSince: string | null;
  durationObs: number;
  confidence: number | null;
  obsConfidence: number | null;
  persistence: number | null;
  updatedAt: string | null;
};

export type RegimeAssetState = {
  asset: string;
  kind: 'FIAT' | 'METAL';
  status: 'CLASSIFIED' | 'WARMING_UP' | 'NO_DATA';
  latest: RegimeSnapshot | null;
  history: RegimeSnapshot[];
  observations: { collected: number; required: number };
  bars: { collected: number | null; required: number | null };
  message?: string | null;
};

export type PairRelationship =
  | 'ALIGNED_LONG'
  | 'ALIGNED_SHORT'
  | 'SAME_REGIME'
  | 'BASE_LED'
  | 'QUOTE_LED'
  | 'NEUTRAL'
  | 'WARMING_UP';

export type RegimePair = {
  symbol: string;
  base: string;
  quote: string;
  status: 'READY' | 'WARMING_UP';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  differential: number | null;
  conviction: number | null;
  persistence: number | null;
  momentum: number | null;
  confidence: number | null;
  baseRegime: RegimeName | null;
  quoteRegime: RegimeName | null;
  relationship: PairRelationship;
  reason: string | null;
  date: string | null;
  updatedAt: string | null;
};

export type TransitionObservation = {
  date: string;
  raw: RegimeName | null;
  composite: number;
  momentum: number | null;
  acceleration: number | null;
  macro: number;
  current: number;
  q: number;
  m: number;
  w: number;
  d: number;
  confidence: number;
};

export type TransitionEvidence = {
  firstSeen?: string;
  confirmedAt?: string;
  previous?: { regime: RegimeName | null; since: string | null; durationObs: number };
  observations?: TransitionObservation[];
  rule?: string;
  ruleObservation?: string;
  thresholds?: { levelBand: number; momentumBand: number; confirmObs: number; minConfidence: number };
};

export type RegimeTransition = {
  id: number;
  asset: string;
  confirmedAt: string;
  firstSeen: string | null;
  previous: RegimeName | null;
  next: RegimeName;
  confidence: number | null;
  reason: string | null;
  evidence: TransitionEvidence;
  createdAt: string | null;
};

export type RegimeRunMeta = {
  status: 'HEALTHY' | 'WARMING_UP' | 'BLOCKED';
  message: string;
  runAt: string;
  durationMs: number;
  latestObsDate?: string | null;
  forming?: boolean;
  missing?: string[];
  config?: Record<string, unknown> & { requiredObs?: number; confirmObs?: number; momentumLag?: number };
  written?: { snapshots: number; transitions: number; pairs: number };
};

export type RegimeStrengthRow = {
  code: string;
  q: number;
  m: number;
  score: number;
  trend: string;
  classification: string;
};

export type RegimeState = {
  ok: boolean;
  message?: string;
  run: RegimeRunMeta | null;
  assets: RegimeAssetState[];
  pairs: RegimePair[];
  transitions: RegimeTransition[];
  strengths: RegimeStrengthRow[];
};

export type RegimeStageStatus = 'WAITING' | 'WARMING UP' | 'RUNNING' | 'HEALTHY' | 'STALE' | 'BLOCKED' | 'ERROR';
