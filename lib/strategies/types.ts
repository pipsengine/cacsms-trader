import type { DashboardTone } from '@/lib/dashboard-card-tones';
import type { Timeframe } from '@/packages/shared-types';

export type StrategyParameterType = 'number' | 'select' | 'symbol' | 'timeframe';

export interface StrategyParameterDefinition {
  key: string;
  label: string;
  type: StrategyParameterType;
  defaultValue: string | number;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface StrategyDefinition {
  id: string;
  group: string;
  label: string;
  family: string;
  description: string;
  algorithm: string;
  status: 'active' | 'planned';
  tone: DashboardTone;
  parameters: StrategyParameterDefinition[];
  minCandles: number;
  rules: string[];
}

export type MovingAverageType = 'sma' | 'ema';

export interface MovingAverageCrossoverConfig {
  symbol: string;
  timeframe: Timeframe;
  fastPeriod: number;
  slowPeriod: number;
  maType: MovingAverageType;
}

export interface MovingAverageCrossoverPoint {
  index: number;
  close: number;
  fastMa: number | null;
  slowMa: number | null;
  signal: 'bullish_cross' | 'bearish_cross' | 'none';
}

export interface MovingAverageCrossoverResult {
  strategyId: 'moving-average-crossover';
  symbol: string;
  timeframe: Timeframe;
  config: MovingAverageCrossoverConfig;
  decision: import('./evaluation').StrategySignalSide;
  confidence: number;
  trendBias: 'bullish' | 'bearish' | 'neutral';
  fastMa: number | null;
  slowMa: number | null;
  maSpread: number | null;
  lastCrossover: {
    type: 'bullish_cross' | 'bearish_cross';
    index: number;
    barsAgo: number;
  } | null;
  reasons: string[];
  series: MovingAverageCrossoverPoint[];
  candleCount: number;
  evaluatedAt: string;
}

export type StrategySignalSide = import('./evaluation').StrategySignalSide;
