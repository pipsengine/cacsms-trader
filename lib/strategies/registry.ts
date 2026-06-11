import type { StrategyDefinition } from './types';

export const MOVING_AVERAGE_CROSSOVER_STRATEGY: StrategyDefinition = {
  id: 'moving-average-crossover',
  group: 'trend-following-strategies',
  label: 'Moving Average Crossover',
  family: 'trend_following',
  description: 'Generates buy and sell signals when a fast moving average crosses above or below a slow moving average.',
  status: 'active',
};

export const STRATEGY_REGISTRY: Record<string, StrategyDefinition> = {
  [MOVING_AVERAGE_CROSSOVER_STRATEGY.id]: MOVING_AVERAGE_CROSSOVER_STRATEGY,
};

export function getStrategyDefinition(strategyId: string): StrategyDefinition | null {
  return STRATEGY_REGISTRY[strategyId] ?? null;
}
