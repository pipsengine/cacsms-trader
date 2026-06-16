import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import {
  isNonDirectionalBias,
  resolveGoldMinRewardRiskForDecision,
} from '@/lib/gold-trade-context';
import { resolveGoldDynamicRewardRisk } from '@/lib/gold-dynamic-reward-risk';
import {
  goldMinInstitutionalQuality,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';

export type GoldInstitutionalQualityResult = {
  ok: boolean;
  score: number;
  minRequired: number;
  blockers: string[];
  breakdown: Record<string, number>;
  tier: 'institutional' | 'acceptable' | 'reject';
};

function sideMatchesBias(side: string, bias: string): boolean {
  if (isNonDirectionalBias(bias)) return true;
  const s = side.toUpperCase();
  const b = bias.toLowerCase();
  if (s === 'BUY') return b.includes('bull');
  if (s === 'SELL') return b.includes('bear');
  return false;
}

export function evaluateGoldInstitutionalQuality(
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
    | 'confidenceScore'
    | 'setupReadinessScore'
    | 'setupType'
    | 'selectedStrategyId'
    | 'strategyBookScore'
    | 'institutionalPlan'
    | 'capitalAllocation'
    | 'signalScore'
    | 'finalBias'
    | 'reasonForDecision'
    | 'macroRiskWarning'
    | 'liquidityWarning'
    | 'regimeClassification'
    | 'tradingStyle'
    | 'timeframe'
  >,
): GoldInstitutionalQualityResult {
  if (!isGoldSymbol(decision.symbol)) {
    return { ok: true, score: 100, minRequired: 0, blockers: [], breakdown: {}, tier: 'institutional' };
  }

  const blockers: string[] = [];
  const breakdown: Record<string, number> = {};
  const minRequired = goldMinInstitutionalQuality();

  if (decision.decision !== 'BUY' && decision.decision !== 'SELL') {
    return { ok: true, score: 0, minRequired, blockers: [], breakdown, tier: 'reject' };
  }

  breakdown.confidence = Math.round(decision.confidenceScore * 0.28);
  breakdown.readiness = Math.round(decision.setupReadinessScore * 0.22);
  breakdown.strategyBook = Math.round((decision.strategyBookScore ?? decision.confidenceScore * 0.85) * 0.18);

  const plan = decision.institutionalPlan;
  let planScore = 0;
  if (plan) {
    const alignedStages = plan.sequence.filter((s) => s.status === 'aligned' || s.status === 'confirmed').length;
    planScore = Math.min(18, alignedStages * 4);
    if (plan.conflict && !plan.countertrendAllowed) {
      blockers.push('Institutional HTF/LTF conflict — setup blocked until structure realigns.');
    }
    if (!sideMatchesBias(decision.decision, plan.htfBias) && !plan.countertrendAllowed) {
      blockers.push(`Trade side ${decision.decision} conflicts with HTF bias ${plan.htfBias}.`);
    }
  }
  breakdown.topDownPlan = planScore;

  const minRewardRisk = resolveGoldMinRewardRiskForDecision(decision);
  const dynamicPlan = resolveGoldDynamicRewardRisk(decision);
  const expectedR = decision.signalScore?.expectedR ?? 0;
  breakdown.expectedR = dynamicPlan.setupScore >= 55 ? 12 : Math.max(0, Math.round(expectedR * 4));
  breakdown.dynamicTarget = dynamicPlan.tier === 'institutional' ? 12 : dynamicPlan.tier === 'elevated' ? 8 : 6;

  const stopLoss = Number((decision as { stopLoss?: number | null }).stopLoss ?? 0);
  const takeProfit = Number((decision as { takeProfitLevels?: number[] }).takeProfitLevels?.[0] ?? 0);
  if (stopLoss > 0 && takeProfit > 0) {
    const entryProxy = Number((decision as { entryZone?: { mid?: number } }).entryZone?.mid ?? 0);
    if (entryProxy > 0) {
      const risk = Math.abs(entryProxy - stopLoss);
      const reward = Math.abs(takeProfit - entryProxy);
      const geometricRr = risk > 0 ? reward / risk : 0;
      if (geometricRr > 0 && geometricRr + 1e-9 < minRewardRisk) {
        blockers.push(`Geometric R:R ${geometricRr.toFixed(2)} below Gold minimum ${minRewardRisk}.`);
      }
    }
  } else if (dynamicPlan.targetR + 1e-9 < minRewardRisk) {
    blockers.push(`Dynamic target ${dynamicPlan.targetR.toFixed(2)}R below Gold minimum ${minRewardRisk}.`);
  }

  if (expectedR > 0 && expectedR < minRewardRisk && dynamicPlan.tier === 'standard') {
    blockers.push(`Model expectancy ${expectedR.toFixed(2)}R below Gold minimum ${minRewardRisk} on standard setup.`);
  }

  const allocation = decision.capitalAllocation?.riskTier ?? 'full';
  breakdown.capitalTier = allocation === 'blocked' ? 0 : allocation === 'minimal' ? 4 : allocation === 'reduced' ? 8 : 12;
  if (allocation === 'blocked') {
    blockers.push('Capital allocation tier blocked this setup.');
  }

  const structureKeywords = /bos|choch|order block|fvg|fair value|liquidity sweep|supply|demand|retracement/i;
  breakdown.structureEvidence = structureKeywords.test(decision.reasonForDecision) ? 8 : 0;
  breakdown.setupType = /structure|liquidity|order.?block|fvg|institutional|smc/i.test(decision.setupType) ? 6 : 2;

  if (
    decision.macroRiskWarning
    && !/no high.?impact|not available|no macro blocker/i.test(decision.macroRiskWarning)
    && /blackout|avoid|blocked|elevated near high.?impact|high.?impact macro risk is active/i.test(decision.macroRiskWarning)
  ) {
    blockers.push(decision.macroRiskWarning);
  }
  if (decision.liquidityWarning && /erratic|thin|unclear|avoid/i.test(decision.liquidityWarning)) {
    blockers.push(decision.liquidityWarning);
  }

  const score = Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0));

  if (score < minRequired) {
    blockers.push(`Gold institutional quality ${score}% below minimum ${minRequired}%.`);
  }

  const tier = score >= minRequired + 10 && dynamicPlan.tier === 'institutional'
    ? 'institutional'
    : score >= minRequired
      ? 'acceptable'
      : 'reject';

  return {
    ok: blockers.length === 0 && score >= minRequired,
    score,
    minRequired,
    blockers,
    breakdown,
    tier,
  };
}
