import type { DashboardTone } from '@/lib/dashboard-card-tones';

export const RESEARCH_EVOLUTION_SLUGS = [
  'strategy-behavioral-analysis',
  'strategy-correlation-analysis',
  'strategy-performance-monitor',
  'ai-reinforcement-learning',
  'adaptive-market-intelligence',
  'market-regime-adaptation',
  'autonomous-strategy-evolution',
  'historical-strategy-comparison',
  'institutional-strategy-framework',
  'hybrid-ai-strategy-intelligence',
] as const;

export type ResearchEvolutionSlug = (typeof RESEARCH_EVOLUTION_SLUGS)[number];

export interface ResearchEvolutionModuleDefinition {
  id: ResearchEvolutionSlug;
  label: string;
  description: string;
  algorithm: string;
  tone: DashboardTone;
}

export const RESEARCH_EVOLUTION_MODULES: ResearchEvolutionModuleDefinition[] = [
  {
    id: 'strategy-behavioral-analysis',
    label: 'Strategy Behavioral Analysis',
    description: 'Behavioral clustering of buy/sell/wait and bias patterns across the active book.',
    algorithm: 'Decision distribution + bias clustering',
    tone: 'violet',
  },
  {
    id: 'strategy-correlation-analysis',
    label: 'Strategy Correlation Analysis',
    description: 'Cross-strategy and cross-group directional correlation matrix proxy.',
    algorithm: 'Group decision alignment correlation',
    tone: 'cyan',
  },
  {
    id: 'strategy-performance-monitor',
    label: 'Strategy Performance Monitor',
    description: 'Live health monitor for confidence, errors, and actionable signal density.',
    algorithm: 'Health score + error rate monitor',
    tone: 'emerald',
  },
  {
    id: 'ai-reinforcement-learning',
    label: 'AI Reinforcement Learning',
    description: 'Reward proxy from confidence and bias-decision alignment for RL-style ranking.',
    algorithm: 'Reward = confidence × alignment',
    tone: 'blue',
  },
  {
    id: 'adaptive-market-intelligence',
    label: 'Adaptive Market Intelligence',
    description: 'Fused book intelligence score adapting to pipeline symbol and signal mix.',
    algorithm: 'Adaptive fusion of book signals',
    tone: 'orange',
  },
  {
    id: 'market-regime-adaptation',
    label: 'Market Regime Adaptation',
    description: 'Regime classification with group-level adaptation weights.',
    algorithm: 'Regime majority + group reweight',
    tone: 'amber',
  },
  {
    id: 'autonomous-strategy-evolution',
    label: 'Autonomous Strategy Evolution',
    description: 'Evolution fitness ranking for engines by composite institutional fitness.',
    algorithm: 'Fitness = score × health factor',
    tone: 'purple',
  },
  {
    id: 'historical-strategy-comparison',
    label: 'Historical Strategy Comparison',
    description: 'Cross-group comparison of confidence and signal density proxies.',
    algorithm: 'Group benchmark comparison',
    tone: 'slate',
  },
  {
    id: 'institutional-strategy-framework',
    label: 'Institutional Strategy Framework',
    description: 'Framework compliance score for book coverage and engine health.',
    algorithm: 'Coverage + health compliance',
    tone: 'violet',
  },
  {
    id: 'hybrid-ai-strategy-intelligence',
    label: 'Hybrid AI Strategy Intelligence',
    description: 'Hybrid and AI-adjacent engine fusion intelligence layer.',
    algorithm: 'Hybrid/AI group fusion score',
    tone: 'cyan',
  },
];

export const RESEARCH_EVOLUTION_MODULE_MAP = Object.fromEntries(
  RESEARCH_EVOLUTION_MODULES.map((item) => [item.id, item]),
) as Record<ResearchEvolutionSlug, ResearchEvolutionModuleDefinition>;

export function isResearchEvolutionSlug(value: string): value is ResearchEvolutionSlug {
  return (RESEARCH_EVOLUTION_SLUGS as readonly string[]).includes(value);
}

export function getResearchEvolutionModule(slug: string): ResearchEvolutionModuleDefinition | null {
  return isResearchEvolutionSlug(slug) ? RESEARCH_EVOLUTION_MODULE_MAP[slug] : null;
}
