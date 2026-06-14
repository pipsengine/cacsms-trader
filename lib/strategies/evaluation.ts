import type { DashboardTone } from '@/lib/dashboard-card-tones';
import type { Timeframe } from '@/packages/shared-types';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { clamp } from './indicators';

export type StrategySignalSide = 'buy' | 'sell' | 'wait';
export type StrategyBias = 'bullish' | 'bearish' | 'neutral';

export interface StrategyEvaluationEvent {
  label: string;
  detail: string;
  tone: DashboardTone;
  barIndex?: number;
}

export interface StrategyEvaluationResult {
  strategyId: string;
  symbol: string;
  timeframe: Timeframe;
  decision: StrategySignalSide;
  confidence: number;
  bias: StrategyBias;
  reasons: string[];
  metrics: Record<string, string | number | null>;
  events: StrategyEvaluationEvent[];
  candleCount: number;
  evaluatedAt: string;
  config: Record<string, unknown>;
}

export interface StrategyEngineContext {
  symbol: string;
  timeframe: Timeframe;
}

export type StrategyEngine = (
  candles: StrategyPriceCandle[],
  config: Record<string, unknown>,
  context: StrategyEngineContext,
) => StrategyEvaluationResult;

export function buildEvaluationResult(input: {
  strategyId: string;
  context: StrategyEngineContext;
  config: Record<string, unknown>;
  candles: StrategyPriceCandle[];
  decision: StrategySignalSide;
  bias: StrategyBias;
  confidence: number;
  reasons: string[];
  metrics?: Record<string, string | number | null>;
  events?: StrategyEvaluationEvent[];
}): StrategyEvaluationResult {
  return {
    strategyId: input.strategyId,
    symbol: input.context.symbol.toUpperCase(),
    timeframe: input.context.timeframe,
    decision: input.decision,
    confidence: Math.round(clamp(input.confidence, 0, 100)),
    bias: input.bias,
    reasons: input.reasons,
    metrics: input.metrics ?? {},
    events: input.events ?? [],
    candleCount: input.candles.length,
    evaluatedAt: new Date().toISOString(),
    config: input.config,
  };
}

export function decisionFromBias(bias: StrategyBias, freshCross?: StrategySignalSide): StrategySignalSide {
  if (freshCross === 'buy' || freshCross === 'sell') return freshCross;
  if (bias === 'bullish') return 'buy';
  if (bias === 'bearish') return 'sell';
  return 'wait';
}
