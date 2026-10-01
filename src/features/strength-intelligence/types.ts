export const ASSETS = ['AUD', 'CAD', 'CHF', 'GBP', 'EUR', 'JPY', 'NZD', 'USD', 'XAU'] as const;
export const HORIZONS = ['YTD', 'HY', 'Q', 'MN', 'W', 'D', 'H8', 'H1', 'M15', 'M5', 'M1'] as const;

export type Asset = (typeof ASSETS)[number];
export type Horizon = (typeof HORIZONS)[number];
export type Direction = 'UP' | 'DOWN' | 'FLAT';
export type FeedStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'DISCONNECTED' | 'DEGRADED';

export type StrengthRow = {
  asset: Asset;
  values: Record<Horizon, number>;
  composite: number;
  previousRank?: number | null;
  rank: number;
  rankChange: number;
  trend: Direction;
  velocity: number;
  acceleration: number;
  persistence: number;
  agreement: number;
  dataQuality: number;
  updatedAt: string;
};

export type HistoryRow = {
  timestamp: string;
  values: Partial<Record<Asset, number>>;
};

export type IntelligenceSnapshot = {
  ok: boolean;
  timestamp: string;
  sequence: number;
  feed: {
    status: FeedStatus;
    message: string;
    latencyMs: number | null;
    lastTick: string | null;
    serverTime?: string;
    nextUiUpdateMs?: number;
  };
  matrix: StrengthRow[];
  average: StrengthRow[];
  history: {
    rows: HistoryRow[];
    total: number;
    period: string;
    resolution: string;
  };
  predictions: {
    status: 'MODEL_NOT_AVAILABLE' | 'ACTIVE';
    modelVersion: string | null;
    generatedAt?: string;
    message?: string;
    rows: unknown[];
  };
  weights: Record<Horizon, number>;
  quality: number;
  dataQuality?: {
    missing?: string[];
    insufficient?: string[];
    missingSymbols?: string[];
    requiredSymbols?: string[];
  };
};

export type TrendState =
  | 'Strong Bullish'
  | 'Bullish'
  | 'Bullish Weakening'
  | 'Neutral / Range'
  | 'Bearish Weakening'
  | 'Bearish'
  | 'Strong Bearish'
  | 'INSUFFICIENT DATA'
  | string;

export type TrendCell = {
  direction: TrendState;
  trendScore: number;
  trendStrength: number;
  structureState: string;
  slope: number;
  momentum: number;
  persistence: number;
  volatilityAdjustedMove: number;
  lastBOS: Record<string, unknown> | null;
  lastCHoCH: Record<string, unknown> | null;
  lastSwingHigh: Record<string, unknown> | null;
  lastSwingLow: Record<string, unknown> | null;
  barsInTrend: number;
  confidence: number;
  timestamp: string;
  dataQuality: string;
};

export type TrendRow = {
  asset: Asset;
  timeframes: Record<Horizon, TrendCell>;
  alignment: number;
  alignmentLabel: string;
  strength: number;
  state: string;
  overallDirection: string;
  persistence: number;
  momentum: number;
  acceleration: number;
  currentStructure: string;
  marketRegime: string;
  htfDirection: string;
  ltfDirection: string;
  titState: string;
  lastStructuralEvent: { kind?: string; direction?: string; timeframe?: string; ts?: number; price?: number } | null;
  lastUpdate: string;
  dataQuality: string;
  explanation: string;
};

export type TrendTransition = {
  id?: number;
  asset: Asset;
  timeframe: Horizon;
  previous: string;
  current: string;
  strength: number;
  event: string;
  time: string;
};

export type TrendHistoryRow = {
  timestamp: string;
  asset: Asset;
  direction: string;
  strength: number;
  alignment: number;
  persistence: number;
  momentum: number;
  acceleration: number;
  regime: string;
  titState: string;
};

export type TrendSnapshot = {
  ok: boolean;
  timestamp: string;
  sequence: number;
  feed: IntelligenceSnapshot['feed'];
  matrix: TrendRow[];
  history: {
    rows: TrendHistoryRow[];
    total: number;
    period: string;
    resolution: string;
  };
  transitions: TrendTransition[];
  weights: Record<Horizon, number>;
  quality: number;
  dataQuality?: {
    missingSymbols?: string[];
  };
};

