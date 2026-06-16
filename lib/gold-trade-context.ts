import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { resolveGoldDynamicRewardRisk } from '@/lib/gold-dynamic-reward-risk';
import { goldMinRewardRisk, isGoldSymbol } from '@/lib/gold-trading-engine';

const RANGE_STRATEGY_ID_PATTERN = /range|mean-reversion|mean_reversion|bollinger-mean|oscillator-range|vwap-range|reversion-range/i;
const RANGE_SETUP_PATTERN = /range|mean-reversion|reversion|oscillator|bollinger|horizontal|consolidation|compression/i;

export function isNonDirectionalBias(bias: string): boolean {
  const b = String(bias ?? '').toLowerCase();
  return b === 'neutral'
    || b === 'mixed'
    || b === 'unknown'
    || b.includes('neutral')
    || b.includes('range')
    || b.includes('ranging');
}

export function resolveExtendedTakeProfitPrice(
  side: 'BUY' | 'SELL',
  takeProfitLevels?: number[],
): number | null {
  const levels = (takeProfitLevels ?? []).filter((level) => Number.isFinite(level) && level > 0);
  if (!levels.length) return null;
  return side === 'BUY' ? Math.max(...levels) : Math.min(...levels);
}

export function computeGeometricRewardRisk(input: {
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}): number {
  if (input.entryPrice <= 0 || input.stopLoss <= 0 || input.takeProfit <= 0) return 0;
  const risk = Math.abs(input.entryPrice - input.stopLoss);
  const reward = Math.abs(input.takeProfit - input.entryPrice);
  return risk > 0 ? Number((reward / risk).toFixed(4)) : 0;
}

export type GoldExecutionRewardRiskResult = {
  ok: boolean;
  blockers: string[];
  geometricRr: number | null;
  extendedTargetR: number;
  floor: number;
};

/** Validate Gold execution R:R using resolved TP levels and dynamic plan — not model expectancy. */
export async function evaluateGoldExecutionRewardRisk(
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
    | 'stopLoss'
    | 'takeProfitLevels'
    | 'confidenceScore'
    | 'setupReadinessScore'
    | 'setupType'
    | 'reasonForDecision'
    | 'institutionalPlan'
    | 'finalBias'
    | 'strategyBookScore'
    | 'regimeClassification'
    | 'tradingStyle'
    | 'timeframe'
    | 'capitalAllocation'
    | 'selectedStrategyId'
  > & Partial<Pick<AutonomousDecisionOutput, 'entryZone'>>,
  livePrice?: number | null,
): Promise<GoldExecutionRewardRiskResult> {
  const blockers: string[] = [];
  if (!isGoldSymbol(decision.symbol) || (decision.decision !== 'BUY' && decision.decision !== 'SELL')) {
    return { ok: true, blockers, geometricRr: null, extendedTargetR: 0, floor: 0 };
  }

  const dynamicPlan = resolveGoldDynamicRewardRisk(decision);
  const floor = dynamicPlan.floor;
  const extendedTargetR = dynamicPlan.extendedTargetR;
  const side = decision.decision;
  const stopLoss = Number(decision.stopLoss ?? 0);
  const extendedTp = resolveExtendedTakeProfitPrice(side, decision.takeProfitLevels);
  const entryProxy = Number((decision.entryZone as { mid?: number })?.mid ?? 0) || Number(livePrice ?? 0);

  let geometricRr: number | null = null;
  if (stopLoss > 0 && extendedTp && entryProxy > 0) {
    geometricRr = computeGeometricRewardRisk({
      side,
      entryPrice: entryProxy,
      stopLoss,
      takeProfit: extendedTp,
    });
    if (geometricRr > 0 && geometricRr + 1e-9 < floor) {
      blockers.push(`Computed R:R ${geometricRr.toFixed(2)} below Gold minimum ${floor}.`);
    }
  } else if (extendedTargetR + 1e-9 < floor) {
    blockers.push(`Dynamic target ${extendedTargetR.toFixed(2)}R below Gold minimum ${floor}.`);
  }

  return { ok: blockers.length === 0, blockers, geometricRr, extendedTargetR, floor };
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
