import { attachGroupLeaders } from './book-ranking-utils';
import { RESEARCH_EVOLUTION_MODULE_MAP, RESEARCH_EVOLUTION_SLUGS } from './research-evolution-modules';
import { evaluateResearchEvolutionModule } from './run-research-evolution';
import { runAutonomousOverviewEvaluations } from './run-strategy-evaluation';
import { evaluateStrategyControlModule } from './run-strategy-control';
import { STRATEGY_CONTROL_MODULE_MAP, STRATEGY_CONTROL_SLUGS } from './strategy-control-modules';
import type { StrategyControlOverviewEntry } from './strategy-control-types';

export interface ModuleSummaryItem {
  id: string;
  label: string;
  decision: string;
  confidence: number;
  summary: string;
}

export interface ModuleSummariesPayload {
  ok: true;
  symbol: string;
  pipelineMode: string;
  bridgeOnline: boolean;
  evaluatedAt: string;
  cachedOverview: boolean;
  control: ModuleSummaryItem[];
  research: ModuleSummaryItem[];
}

export async function runModuleSummaries(options?: { force?: boolean }): Promise<ModuleSummariesPayload> {
  const overview = await runAutonomousOverviewEvaluations(options);
  const entries = overview.strategies as StrategyControlOverviewEntry[];

  const control = STRATEGY_CONTROL_SLUGS.map((moduleId) => {
    const result = evaluateStrategyControlModule(moduleId, entries, overview.evaluatedAt, overview.symbol);
    result.rankings = attachGroupLeaders(result.rankings, entries);
    return {
      id: moduleId,
      label: STRATEGY_CONTROL_MODULE_MAP[moduleId].label,
      decision: result.decision,
      confidence: result.confidence,
      summary: result.summary,
    };
  });

  const research = RESEARCH_EVOLUTION_SLUGS.map((moduleId) => {
    const result = evaluateResearchEvolutionModule(moduleId, entries, overview.evaluatedAt, overview.symbol);
    result.rankings = attachGroupLeaders(result.rankings, entries);
    return {
      id: moduleId,
      label: RESEARCH_EVOLUTION_MODULE_MAP[moduleId].label,
      decision: result.decision,
      confidence: result.confidence,
      summary: result.summary,
    };
  });

  return {
    ok: true,
    symbol: overview.symbol,
    pipelineMode: overview.pipelineMode,
    bridgeOnline: overview.bridgeOnline,
    evaluatedAt: overview.evaluatedAt,
    cachedOverview: Boolean(options?.force !== true),
    control,
    research,
  };
}
