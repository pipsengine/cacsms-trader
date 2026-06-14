import type { DashboardTone } from '@/lib/dashboard-card-tones';

export const STRATEGY_CONTROL_SLUGS = [
  'ai-strategy-selector',
  'autonomous-strategy-rotation',
  'strategy-scoring-engine',
  'strategy-confidence-engine',
  'strategy-optimization-engine',
  'strategy-adaptation-engine',
  'strategy-risk-profiler',
  'multi-strategy-orchestration',
] as const;

export type StrategyControlSlug = (typeof STRATEGY_CONTROL_SLUGS)[number];

export interface StrategyControlModuleDefinition {
  id: StrategyControlSlug;
  label: string;
  description: string;
  algorithm: string;
  tone: DashboardTone;
}

export const STRATEGY_CONTROL_MODULES: StrategyControlModuleDefinition[] = [
  {
    id: 'ai-strategy-selector',
    label: 'AI Strategy Selector',
    description: 'Ranks active engines by composite selection score and pipeline alignment.',
    algorithm: 'Confidence-weighted ranking + signal alignment',
    tone: 'violet',
  },
  {
    id: 'autonomous-strategy-rotation',
    label: 'Autonomous Strategy Rotation',
    description: 'Rotates focus basket across strategy groups on pipeline-driven schedule.',
    algorithm: 'Time-slot rotation + group diversification',
    tone: 'cyan',
  },
  {
    id: 'strategy-scoring-engine',
    label: 'Strategy Scoring Engine',
    description: 'Composite institutional score for every active strategy engine.',
    algorithm: 'Decision weight × confidence + bias coherence',
    tone: 'blue',
  },
  {
    id: 'strategy-confidence-engine',
    label: 'Strategy Confidence Engine',
    description: 'Aggregates and normalizes confidence across the active strategy book.',
    algorithm: 'Book-wide confidence stats + group normalization',
    tone: 'emerald',
  },
  {
    id: 'strategy-optimization-engine',
    label: 'Strategy Optimization Engine',
    description: 'Identifies under-performing engines and optimization opportunities.',
    algorithm: 'Wait-ratio analysis + low-confidence flagging',
    tone: 'amber',
  },
  {
    id: 'strategy-adaptation-engine',
    label: 'Strategy Adaptation Engine',
    description: 'Detects market regime and recommends strategy group adaptation.',
    algorithm: 'Book bias majority + group favor weights',
    tone: 'orange',
  },
  {
    id: 'strategy-risk-profiler',
    label: 'Strategy Risk Profiler',
    description: 'Profiles signal aggression and error risk per strategy and group.',
    algorithm: 'Signal density + confidence variance risk tiers',
    tone: 'rose',
  },
  {
    id: 'multi-strategy-orchestration',
    label: 'Multi-Strategy Orchestration',
    description: 'Orchestrates complementary and conflicting signals across the book.',
    algorithm: 'Top-stack selection + conflict detection',
    tone: 'slate',
  },
];

export const STRATEGY_CONTROL_MODULE_MAP = Object.fromEntries(
  STRATEGY_CONTROL_MODULES.map((item) => [item.id, item]),
) as Record<StrategyControlSlug, StrategyControlModuleDefinition>;

export function isStrategyControlSlug(value: string): value is StrategyControlSlug {
  return (STRATEGY_CONTROL_SLUGS as readonly string[]).includes(value);
}

export function getStrategyControlModule(slug: string): StrategyControlModuleDefinition | null {
  return isStrategyControlSlug(slug) ? STRATEGY_CONTROL_MODULE_MAP[slug] : null;
}
