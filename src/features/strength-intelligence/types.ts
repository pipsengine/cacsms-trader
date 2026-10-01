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

