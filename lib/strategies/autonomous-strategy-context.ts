import { getAutonomousPipelineStatus } from '@/lib/autonomous-pipeline-store';
import type { Timeframe } from '@/packages/shared-types';

import type { StrategyDefinition } from './types';

export const STRATEGY_AUTONOMOUS_REFRESH_MS = 15_000;

const GROUP_TIMEFRAME_PREFERENCE: Record<string, Timeframe> = {
  'trend-following-strategies': 'H4',
  'breakout-trading-strategies': 'H1',
  'scalping-strategies': 'M15',
  'day-trading-strategies': 'M15',
  'swing-trading-strategies': 'H4',
  'position-trading-strategies': 'D1',
  'price-action-strategies': 'H1',
  'indicator-based-strategies': 'H1',
  'mean-reversion-strategies': 'H1',
  'momentum-trading-strategies': 'H1',
  'reversal-trading-strategies': 'H1',
  'range-trading-strategies': 'H1',
  'smart-money-and-institutional-strategies': 'H1',
  'quantitative-and-algorithmic-strategies': 'H1',
  'fundamental-trading-strategies': 'H4',
  'news-trading-strategies': 'M15',
  'volatility-based-strategies': 'H1',
  'correlation-and-intermarket-strategies': 'H1',
  'hedging-strategies': 'H4',
  'arbitrage-strategies': 'M15',
  'session-based-strategies': 'M15',
  'pattern-trading-strategies': 'H4',
  'candlestick-trading-strategies': 'H1',
  'risk-management-strategies': 'H4',
  'advanced-professional-and-institutional-models': 'H4',
  'hybrid-strategies': 'H1',
};

export interface AutonomousStrategyContext {
  symbol: string;
  timeframe: Timeframe;
  pipelineMode: string;
  activeSymbols: string[];
  pairSelectionSource: string | null;
  bridgeOnline: boolean;
  refreshIntervalMs: number;
  config: Record<string, unknown>;
}

export function resolveAutonomousTimeframeForGroup(group: string): Timeframe {
  return GROUP_TIMEFRAME_PREFERENCE[group] ?? 'H1';
}

export function buildAutonomousConfig(definition: StrategyDefinition, symbol: string, timeframe: Timeframe): Record<string, unknown> {
  const config: Record<string, unknown> = {
    symbol,
    timeframe,
    autonomous: true,
  };
  for (const parameter of definition.parameters) {
    if (parameter.key === 'symbol' || parameter.key === 'timeframe') continue;
    config[parameter.key] = parameter.type === 'number'
      ? Number(parameter.defaultValue)
      : parameter.defaultValue;
  }
  return config;
}

export async function resolveAutonomousStrategyContext(definition: StrategyDefinition): Promise<AutonomousStrategyContext> {
  const status = await getAutonomousPipelineStatus('AUTO', { advance: false });
  const symbol = String(
    status.pairSelection?.selectedSymbol
    ?? status.activeSymbol
    ?? status.activeSymbols[0]
    ?? 'XAUUSD',
  ).toUpperCase();
  const timeframe = resolveAutonomousTimeframeForGroup(definition.group);

  return {
    symbol,
    timeframe,
    pipelineMode: status.mode,
    activeSymbols: status.activeSymbols,
    pairSelectionSource: status.pairSelection?.source ?? null,
    bridgeOnline: status.bridgeOnline,
    refreshIntervalMs: STRATEGY_AUTONOMOUS_REFRESH_MS,
    config: buildAutonomousConfig(definition, symbol, timeframe),
  };
}

export async function resolveAutonomousPipelineSymbol(): Promise<{
  symbol: string;
  pipelineMode: string;
  activeSymbols: string[];
  bridgeOnline: boolean;
}> {
  const status = await getAutonomousPipelineStatus('AUTO', { advance: false });
  const symbol = String(
    status.pairSelection?.selectedSymbol
    ?? status.activeSymbol
    ?? status.activeSymbols[0]
    ?? 'XAUUSD',
  ).toUpperCase();
  return {
    symbol,
    pipelineMode: status.mode,
    activeSymbols: status.activeSymbols,
    bridgeOnline: status.bridgeOnline,
  };
}
