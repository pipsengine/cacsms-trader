import type { StrategyControlSlug } from './strategy-control-modules';

export type StrategyControlSignalSide = 'buy' | 'sell' | 'wait';
export type StrategyControlBias = 'bullish' | 'bearish' | 'neutral';

export interface StrategyControlOverviewEntry {
  id: string;
  label: string;
  group: string;
  tone: string;
  decision: StrategyControlSignalSide;
  confidence: number;
  bias: StrategyControlBias | string;
  evaluatedAt: string | null;
  error: string | null;
}

export interface StrategyControlRankingRow {
  id: string;
  label: string;
  group: string;
  score: number;
  decision: StrategyControlSignalSide;
  confidence: number;
  bias: string;
  detail?: string;
  /** Top engine in group when row.id is a group slug */
  linkStrategyId?: string;
}

export interface StrategyControlResult {
  moduleId: StrategyControlSlug;
  label: string;
  summary: string;
  decision: StrategyControlSignalSide | 'neutral';
  confidence: number;
  reasons: string[];
  metrics: Record<string, string | number | null>;
  rankings: StrategyControlRankingRow[];
  evaluatedAt: string;
}

export interface StrategyControlPayload {
  ok: true;
  moduleId: StrategyControlSlug;
  symbol: string;
  pipelineMode: string;
  activeSymbols: string[];
  bridgeOnline: boolean;
  refreshIntervalMs: number;
  evaluatedAt: string;
  result: StrategyControlResult;
}

export const STRATEGY_CONTROL_REFRESH_MS = 15_000;
