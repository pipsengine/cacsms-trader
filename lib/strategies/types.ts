import type { Timeframe } from '@/packages/shared-types';

export type StrategySignalSide = 'buy' | 'sell' | 'wait';
export type MovingAverageType = 'sma' | 'ema';

export interface StrategyDefinition {
  id: string;
  group: string;
  label: string;
  family: string;
  description: string;
  status: 'active' | 'planned';
}

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
  decision: StrategySignalSide;
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
