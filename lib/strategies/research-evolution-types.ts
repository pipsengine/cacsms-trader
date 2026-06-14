import type { ResearchEvolutionSlug } from './research-evolution-modules';
import type {
  StrategyControlOverviewEntry,
  StrategyControlRankingRow,
  StrategyControlSignalSide,
} from './strategy-control-types';

export type ResearchEvolutionResult = {
  moduleId: ResearchEvolutionSlug;
  label: string;
  summary: string;
  decision: StrategyControlSignalSide | 'neutral';
  confidence: number;
  reasons: string[];
  metrics: Record<string, string | number | null>;
  rankings: StrategyControlRankingRow[];
  evaluatedAt: string;
};

export interface ResearchEvolutionPayload {
  ok: true;
  moduleId: ResearchEvolutionSlug;
  symbol: string;
  pipelineMode: string;
  activeSymbols: string[];
  bridgeOnline: boolean;
  refreshIntervalMs: number;
  evaluatedAt: string;
  result: ResearchEvolutionResult;
}

export type BookEntry = StrategyControlOverviewEntry;

export const RESEARCH_EVOLUTION_REFRESH_MS = 15_000;
