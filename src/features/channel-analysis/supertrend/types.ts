export const SUPERTREND_TIMEFRAMES = ['YTD', 'Q', 'MN', 'W', 'D', 'H8', 'H1', 'M15'] as const;
export type SupertrendTimeframe = (typeof SUPERTREND_TIMEFRAMES)[number];
export type TrendDirection = 'UP' | 'DOWN' | 'UNKNOWN';
export type DataHealth = 'LIVE' | 'DELAYED' | 'STALE' | 'DISCONNECTED' | 'INSUFFICIENT_DATA' | 'ERROR';

export interface SupertrendSettings {
  atrMultiplier: number;
  atrPeriod: number;
  triggerCandle: 'PREVIOUS';
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export interface PaintedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  complete: boolean;
  trend: TrendDirection;
  supertrend: number | null;
  atr: number | null;
}

export interface SupertrendPoint {
  time: number;
  value: number | null;
  direction: TrendDirection;
  atr: number | null;
  upperBand: number | null;
  lowerBand: number | null;
  complete: boolean;
}

export interface SupertrendCardSnapshot {
  symbol: string;
  timeframe: SupertrendTimeframe;
  direction: TrendDirection;
  confirmedDirection: TrendDirection;
  currentPrice: number | null;
  confirmedClose: number | null;
  supertrend: number | null;
  atr: number | null;
  distancePrice: number | null;
  distanceAtr: number | null;
  barsSinceFlip: number | null;
  lastFlipTime: number | null;
  lastClosedCandleTime: number | null;
  freshnessMs: number | null;
  health: DataHealth;
  dataQuality: DataHealth;
  barCount: number;
  multiplier: number;
  atrPeriod: number;
  triggerCandle: 'PREVIOUS';
  candles: PaintedCandle[];
  points: SupertrendPoint[];
  sequence: number;
  settingsRevision: number;
  digits: number;
  calculatedAt: string;
}

export interface AlignmentSummary {
  bullish: number;
  bearish: number;
  unknown: number;
  total: number;
  alignmentPct: number;
  dominant: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNKNOWN';
  htfBias: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNKNOWN';
  executionBias: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNKNOWN';
  titState: string;
  interpretation: string;
}

export interface SupertrendSnapshot {
  ok: boolean;
  symbol: string;
  generatedAt: string;
  sequence: number;
  settings: SupertrendSettings;
  health: DataHealth;
  alignment: AlignmentSummary;
  cards: Record<SupertrendTimeframe, SupertrendCardSnapshot>;
  transitions: unknown[];
  message?: string;
}

