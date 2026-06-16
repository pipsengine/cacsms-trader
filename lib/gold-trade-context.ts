import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { goldMinRewardRisk } from '@/lib/gold-trading-engine';

const RANGE_STRATEGY_ID_PATTERN = /range|mean-reversion|mean_reversion|bollinger-mean|oscillator-range|vwap-range|reversion-range/i;
const RANGE_SETUP_PATTERN = /range|mean-reversion|reversion|oscillator|bollinger|horizontal|consolidation|compression/i;

export function isNonDirectionalBias(bias: string): boolean {
  const b = String(bias ?? '').toLowerCase();
  return b === 'neutral'
    || b === 'mixed'
    || b === 'unknown'
    || b.includes('range')
    || b.includes('ranging');
}

export function isRangeOrientedContext(
  decision: Pick<
    AutonomousDecisionOutput,
    'selectedStrategyId' | 'setupType' | 'regimeClassification' | 'tradingStyle'
  >,
): boolean {
  const strategyId = String(decision.selectedStrategyId ?? '');
  if (RANGE_STRATEGY_ID_PATTERN.test(strategyId)) return true;

  const setupType = String(decision.setupType ?? '');
  if (RANGE_SETUP_PATTERN.test(setupType)) return true;

  const regime = decision.regimeClassification;
  if (!regime) return false;
  if (regime.primary === 'range' || regime.primary === 'compression') return true;
  return regime.tags.some((tag) => tag === 'range' || tag === 'compression');
}

/** Style- and regime-aware Gold R:R floor — all setups must meet minimum (default 1:2). */
export function resolveGoldMinRewardRiskForDecision(
  decision: Pick<
    AutonomousDecisionOutput,
    | 'tradingStyle'
    | 'regimeClassification'
    | 'selectedStrategyId'
    | 'setupType'
    | 'institutionalPlan'
  >,
): number {
  void decision;
  return goldMinRewardRisk();
}
