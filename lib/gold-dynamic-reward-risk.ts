import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import {
  goldInstitutionalTargetRewardRisk,
  goldMaxTargetRewardRisk,
  goldMinRewardRisk,
  goldSessionPriority,
  goldTargetRewardRisk,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';
import { isNonDirectionalBias, isRangeOrientedContext } from '@/lib/gold-trade-context';

export type GoldRewardRiskTier = 'standard' | 'elevated' | 'institutional';

export type GoldPartialCloseStage = {
  atR: number;
  fraction: number;
  label: string;
};

export type GoldDynamicRewardRiskPlan = {
  floor: number;
  targetR: number;
  extendedTargetR: number;
  tier: GoldRewardRiskTier;
  setupScore: number;
  takeProfitRs: number[];
  partialCloseStages: GoldPartialCloseStage[];
  breakEvenAtR: number;
  profitLockAtR: number;
  trailActivateAtR: number;
  rationale: string[];
};

const STRUCTURE_PATTERN = /bos|choch|break of structure|change of character|order block|fvg|fair value|liquidity sweep|sweep|supply|demand|mitigation/i;

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sideMatchesBias(side: string, bias: string): boolean {
  if (isNonDirectionalBias(bias)) return false;
  const s = side.toUpperCase();
  const b = bias.toLowerCase();
  if (s === 'BUY') return b.includes('bull');
  if (s === 'SELL') return b.includes('bear');
  return false;
}

function scoreStructureEvidence(decision: Pick<AutonomousDecisionOutput, 'reasonForDecision' | 'setupType'>): number {
  const text = `${decision.reasonForDecision ?? ''} ${decision.setupType ?? ''}`;
  if (!STRUCTURE_PATTERN.test(text)) return 0;
  let score = 6;
  if (/bos|break of structure/i.test(text)) score += 4;
  if (/choch|change of character/i.test(text)) score += 4;
  if (/order block/i.test(text)) score += 4;
  if (/fvg|fair value/i.test(text)) score += 3;
  if (/liquidity sweep|sweep/i.test(text)) score += 4;
  return Math.min(18, score);
}

function scoreTopDownAlignment(
  decision: Pick<AutonomousDecisionOutput, 'decision' | 'institutionalPlan' | 'finalBias'>,
): number {
  const plan = decision.institutionalPlan;
  if (!plan) return 0;
  const aligned = plan.sequence.filter((stage) => stage.status === 'aligned' || stage.status === 'confirmed').length;
  let score = Math.min(20, aligned * 5);
  if (sideMatchesBias(decision.decision, plan.htfBias)) score += 10;
  if (sideMatchesBias(decision.decision, decision.finalBias)) score += 4;
  if (plan.countertrendAllowed) score -= 6;
  return Math.max(0, score);
}

function scoreSessionStrength(decision: Pick<AutonomousDecisionOutput, 'tradingStyle' | 'timeframe'>): number {
  const session = inferSessionFromStyle(decision.tradingStyle, decision.timeframe);
  const priority = goldSessionPriority(session);
  if (priority >= 88) return 8;
  if (priority >= 80) return 6;
  if (priority >= 70) return 4;
  return 2;
}

function inferSessionFromStyle(tradingStyle: string | undefined, timeframe: string): string {
  const tf = String(timeframe ?? '').toUpperCase();
  if (tradingStyle === 'scalp' || tf === 'M5' || tf === 'M1') return 'london';
  if (tradingStyle === 'swing' || tf === 'H4' || tf === 'D') return 'overlap';
  return 'new_york';
}

function buildPartialCloseStages(targetR: number, extendedTargetR: number): GoldPartialCloseStage[] {
  const first = clamp(targetR * 0.5, 1.5, 2);
  const second = clamp(targetR * 0.67, 2, 2.5);
  const third = clamp(targetR * 0.85, 2.5, extendedTargetR * 0.75);
  return [
    { atR: Number(first.toFixed(2)), fraction: 0.25, label: 'TP1 scale-out' },
    { atR: Number(second.toFixed(2)), fraction: 0.25, label: 'TP2 scale-out' },
    { atR: Number(third.toFixed(2)), fraction: 0.25, label: 'TP3 scale-out' },
  ];
}

function buildTakeProfitRs(targetR: number, extendedTargetR: number): number[] {
  const levels = new Set<number>([
    clamp(targetR * 0.5, 1.5, 2),
    clamp(targetR * 0.67, 2, 2.5),
    Number(targetR.toFixed(2)),
    Number(extendedTargetR.toFixed(2)),
  ]);
  return [...levels].sort((a, b) => a - b);
}

function resolveTierAndTargets(setupScore: number, rangeOriented: boolean): {
  tier: GoldRewardRiskTier;
  targetR: number;
  extendedTargetR: number;
} {
  const standardTarget = goldTargetRewardRisk();
  const institutionalTarget = goldInstitutionalTargetRewardRisk();
  const maxTarget = goldMaxTargetRewardRisk();

  if (rangeOriented) {
    return {
      tier: 'standard',
      targetR: standardTarget,
      extendedTargetR: clamp(standardTarget + 0.5, standardTarget, maxTarget),
    };
  }

  if (setupScore >= 85) {
    const extended = clamp(institutionalTarget + 1, institutionalTarget, maxTarget);
    return { tier: 'institutional', targetR: institutionalTarget, extendedTargetR: extended };
  }
  if (setupScore >= 72) {
    return {
      tier: 'institutional',
      targetR: institutionalTarget,
      extendedTargetR: clamp(institutionalTarget + 0.5, institutionalTarget, maxTarget),
    };
  }
  if (setupScore >= 55) {
    const target = clamp(standardTarget + 0.5, standardTarget, institutionalTarget);
    return {
      tier: 'elevated',
      targetR: target,
      extendedTargetR: clamp(institutionalTarget, target, maxTarget),
    };
  }

  return {
    tier: 'standard',
    targetR: standardTarget,
    extendedTargetR: clamp(standardTarget + 1, standardTarget, maxTarget),
  };
}

/** Score setup quality (0–100) from institutional structure, MTF alignment, session, and model confidence. */
export function scoreGoldSetupRewardPotential(
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
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
  >,
): { score: number; breakdown: Record<string, number> } {
  if (!isGoldSymbol(decision.symbol)) {
    return { score: 0, breakdown: {} };
  }

  const breakdown: Record<string, number> = {};
  breakdown.confidence = Math.round(decision.confidenceScore * 0.15);
  breakdown.readiness = Math.round(decision.setupReadinessScore * 0.12);
  breakdown.strategyBook = Math.round((decision.strategyBookScore ?? decision.confidenceScore * 0.85) * 0.1);
  breakdown.structure = scoreStructureEvidence(decision);
  breakdown.topDown = scoreTopDownAlignment(decision);
  breakdown.session = scoreSessionStrength(decision);

  const regime = decision.regimeClassification?.primary ?? '';
  breakdown.regime = regime === 'trend' || regime === 'expansion' ? 10 : regime === 'range' || regime === 'compression' ? 2 : 6;

  const allocation = decision.capitalAllocation?.riskTier ?? 'full';
  breakdown.capital = allocation === 'blocked' ? 0 : allocation === 'minimal' ? 3 : allocation === 'reduced' ? 6 : 10;

  const score = Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  return { score, breakdown };
}

/** Resolve dynamic Gold R:R plan — floor 1:2, default target 1:3, up to 1:5+ for institutional setups. */
export function resolveGoldDynamicRewardRisk(
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
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
  >,
): GoldDynamicRewardRiskPlan {
  const floor = goldMinRewardRisk();
  const rangeOriented = isRangeOrientedContext(decision);
  const { score, breakdown } = scoreGoldSetupRewardPotential(decision);
  const { tier, targetR, extendedTargetR } = resolveTierAndTargets(score, rangeOriented);

  const rationale: string[] = [
    `Setup score ${score}/100 (${tier} tier).`,
    `Floor ${floor}R · primary ${targetR}R · extended ${extendedTargetR}R.`,
  ];
  if (breakdown.structure > 0) rationale.push('Structure confluence (BOS/CHoCH/OB/FVG/sweep) elevated target.');
  if (breakdown.topDown >= 15) rationale.push('Multi-timeframe alignment supports extended target.');
  if (rangeOriented) rationale.push('Range-oriented context — capped at standard target band.');

  const breakEvenAtR = Math.max(
    envNumber('CACSMS_GOLD_STANDARD_BE_R', 0.85),
    clamp(targetR * 0.28, 0.75, 1.1),
  );
  const profitLockAtR = clamp(targetR * 0.55, 1.2, targetR * 0.75);
  const trailActivateAtR = clamp(targetR * 0.72, 1.8, extendedTargetR * 0.65);

  return {
    floor,
    targetR,
    extendedTargetR,
    tier,
    setupScore: score,
    takeProfitRs: buildTakeProfitRs(targetR, extendedTargetR),
    partialCloseStages: buildPartialCloseStages(targetR, extendedTargetR),
    breakEvenAtR: Number(breakEvenAtR.toFixed(2)),
    profitLockAtR: Number(profitLockAtR.toFixed(2)),
    trailActivateAtR: Number(trailActivateAtR.toFixed(2)),
    rationale,
  };
}

export function buildGoldTakeProfitPrices(input: {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopDistance: number;
  plan: GoldDynamicRewardRiskPlan;
  supports?: number[];
  resistances?: number[];
}): { levels: number[]; primaryTakeProfit: number; extendedTakeProfit: number; rewardRiskRatio: number } {
  const round = (price: number) => {
    const digits = input.symbol.toUpperCase().includes('XAU') ? 2 : 5;
    return Number(price.toFixed(digits));
  };

  const opposingLevels = input.side === 'BUY'
    ? (input.resistances ?? []).filter((level) => level > input.entryPrice).sort((a, b) => a - b)
    : (input.supports ?? []).filter((level) => level < input.entryPrice).sort((a, b) => b - a);

  const prices = input.plan.takeProfitRs.map((rMultiple) => {
    const raw = input.side === 'BUY'
      ? input.entryPrice + input.stopDistance * rMultiple
      : input.entryPrice - input.stopDistance * rMultiple;

    const snap = opposingLevels.find((level) => {
      const distance = Math.abs(level - raw);
      const tolerance = Math.max(input.stopDistance * 0.15, 0.5);
      return distance <= tolerance;
    });

    if (snap) {
      const snappedR = Math.abs(snap - input.entryPrice) / input.stopDistance;
      if (snappedR + 1e-9 >= input.plan.floor) return round(snap);
    }
    return round(raw);
  });

  const uniqueLevels = [...new Set(prices)].sort((a, b) => (input.side === 'BUY' ? a - b : b - a));
  const primaryTakeProfit = uniqueLevels.find((price) => {
    const r = Math.abs(price - input.entryPrice) / input.stopDistance;
    return r + 1e-9 >= input.plan.targetR;
  }) ?? uniqueLevels[uniqueLevels.length - 1] ?? round(
    input.side === 'BUY'
      ? input.entryPrice + input.stopDistance * input.plan.targetR
      : input.entryPrice - input.stopDistance * input.plan.targetR,
  );

  const extendedTakeProfit = round(
    input.side === 'BUY'
      ? input.entryPrice + input.stopDistance * input.plan.extendedTargetR
      : input.entryPrice - input.stopDistance * input.plan.extendedTargetR,
  );

  const rewardRiskRatio = input.stopDistance > 0
    ? Number((Math.abs(primaryTakeProfit - input.entryPrice) / input.stopDistance).toFixed(4))
    : input.plan.targetR;

  return {
    levels: uniqueLevels,
    primaryTakeProfit,
    extendedTakeProfit,
    rewardRiskRatio,
  };
}

export function readGoldRewardRiskPlan(metadata: Record<string, unknown> | null | undefined): GoldDynamicRewardRiskPlan | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata.rewardRiskPlan;
  if (!raw || typeof raw !== 'object') return null;
  const plan = raw as Record<string, unknown>;
  const floor = Number(plan.floor ?? 0);
  const targetR = Number(plan.targetR ?? 0);
  if (!floor || !targetR) return null;
  return {
    floor,
    targetR,
    extendedTargetR: Number(plan.extendedTargetR ?? targetR),
    tier: (plan.tier as GoldRewardRiskTier) ?? 'standard',
    setupScore: Number(plan.setupScore ?? 0),
    takeProfitRs: Array.isArray(plan.takeProfitRs) ? plan.takeProfitRs.map(Number) : [targetR],
    partialCloseStages: Array.isArray(plan.partialCloseStages)
      ? plan.partialCloseStages.map((stage) => {
        const row = stage as Record<string, unknown>;
        return {
          atR: Number(row.atR ?? 0),
          fraction: Number(row.fraction ?? 0.25),
          label: String(row.label ?? 'scale-out'),
        };
      })
      : buildPartialCloseStages(targetR, Number(plan.extendedTargetR ?? targetR)),
    breakEvenAtR: Number(plan.breakEvenAtR ?? 0.85),
    profitLockAtR: Number(plan.profitLockAtR ?? 1.5),
    trailActivateAtR: Number(plan.trailActivateAtR ?? 2),
    rationale: Array.isArray(plan.rationale) ? plan.rationale.map(String) : [],
  };
}
