import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import {
  goldScalpMinInstitutionalQuality,
  goldScalpMinRewardRisk,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';
import { isNonDirectionalBias, isRangeOrientedContext } from '@/lib/gold-trade-context';

const HTF_TIMEFRAMES = ['H4', 'H1'] as const;
const LTF_EXECUTION_TIMEFRAMES = ['M15', 'M5', 'M1'] as const;

const RANGE_TEXT_PATTERN = /range|ranging|consolidat|compress|sideways|balance|chop|horizontal|mean.?reversion/i;

export type GoldLtfScalpContext = {
  /** HTF is ranging — shift execution to M15/M5 scalps. */
  active: boolean;
  htfRanging: boolean;
  htfTimeframesRanging: string[];
  ltfEntryTimeframe: 'M15' | 'M5';
  preferredTradingStyle: 'scalp' | 'intraday';
  reasons: string[];
};

type TimeframeStateLike = {
  timeframe?: string;
  bias?: string;
  confirmsEntry?: boolean;
  narrative?: string;
  marketStructure?: string;
  trendDirection?: string;
};

function normalizeTf(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function isDirectionalBias(bias: string): boolean {
  const text = String(bias ?? '').toLowerCase();
  return text.includes('bull') || text.includes('bear');
}

export function isTimeframeSnapshotRanging(input?: TimeframeStateLike | null): boolean {
  if (!input) return false;
  const bias = String(input.bias ?? '').toLowerCase();
  if (isNonDirectionalBias(bias) || bias.includes('range')) return true;
  const text = [
    input.marketStructure,
    input.trendDirection,
    input.narrative,
  ].map((item) => String(item ?? '')).join(' ').toLowerCase();
  return RANGE_TEXT_PATTERN.test(text);
}

export function detectHtfRangingFromStates(states: readonly TimeframeStateLike[]): {
  htfRanging: boolean;
  htfTimeframesRanging: string[];
} {
  const htfTimeframesRanging = HTF_TIMEFRAMES.filter((tf) => {
    const state = states.find((item) => normalizeTf(item.timeframe ?? '') === tf);
    return isTimeframeSnapshotRanging(state);
  });
  return {
    htfRanging: htfTimeframesRanging.length > 0,
    htfTimeframesRanging: [...htfTimeframesRanging],
  };
}

export function resolveLtfExecutionBias(states: readonly TimeframeStateLike[]): 'bullish' | 'bearish' | 'neutral' {
  for (const tf of LTF_EXECUTION_TIMEFRAMES) {
    const state = states.find((item) => normalizeTf(item.timeframe ?? '') === tf);
    if (!state) continue;
    const bias = String(state.bias ?? '').toLowerCase();
    if (bias.includes('bull')) return 'bullish';
    if (bias.includes('bear')) return 'bearish';
  }
  return 'neutral';
}

export function hasLtfExecutionConfirmation(states: readonly TimeframeStateLike[]): boolean {
  return LTF_EXECUTION_TIMEFRAMES.some((tf) => {
    const state = states.find((item) => normalizeTf(item.timeframe ?? '') === tf);
    if (!state) return false;
    const bias = String(state.bias ?? '').toLowerCase();
    return isDirectionalBias(bias) && (state.confirmsEntry === true || isDirectionalBias(bias));
  });
}

export function detectGoldLtfScalpContext(input: {
  symbol?: string;
  timeframeStates?: readonly TimeframeStateLike[];
  marketPhase?: string;
  regime?: string;
  mtfScalpOnly?: boolean;
  mtfFinalBias?: string;
  institutionalPlan?: AutonomousDecisionOutput['institutionalPlan'] | null;
  tradingStyle?: string | null;
  selectedStrategyId?: string | null;
  setupType?: string | null;
  regimeClassification?: AutonomousDecisionOutput['regimeClassification'] | null;
}): GoldLtfScalpContext {
  const reasons: string[] = [];
  const states = input.timeframeStates ?? [];
  const { htfRanging, htfTimeframesRanging } = detectHtfRangingFromStates(states);

  const phaseText = String(input.marketPhase ?? '').toLowerCase();
  const phaseRanging = RANGE_TEXT_PATTERN.test(phaseText) || /compression|consolidation/.test(phaseText);
  const mtfBiasRanging = RANGE_TEXT_PATTERN.test(String(input.mtfFinalBias ?? '').toLowerCase());
  const planRanging = Boolean(input.institutionalPlan?.rangingContextActive);
  const regimeRanging = input.regime === 'range'
    || input.regime === 'compression'
    || input.regimeClassification?.primary === 'range'
    || input.regimeClassification?.primary === 'compression'
    || isRangeOrientedContext({
      selectedStrategyId: input.selectedStrategyId ?? null,
      setupType: input.setupType ?? '',
      regimeClassification: input.regimeClassification ?? undefined,
      tradingStyle: input.tradingStyle as AutonomousDecisionOutput['tradingStyle'],
    });

  if (htfRanging) {
    reasons.push(`HTF ranging on ${htfTimeframesRanging.join(', ')} — LTF scalp path enabled.`);
  }
  if (input.mtfScalpOnly) reasons.push('MTF fusion flagged scalp-only posture.');
  if (phaseRanging) reasons.push(`Market phase "${input.marketPhase}" supports range/scalp execution.`);
  if (planRanging || regimeRanging) reasons.push('Range-oriented regime — HTF trend alignment not required.');

  const active = Boolean(
    input.mtfScalpOnly
    || htfRanging
    || (phaseRanging && hasLtfExecutionConfirmation(states))
    || (regimeRanging && hasLtfExecutionConfirmation(states))
    || (planRanging && hasLtfExecutionConfirmation(states))
    || (mtfBiasRanging && hasLtfExecutionConfirmation(states)),
  );

  const m5Ready = states.some((item) => normalizeTf(item.timeframe ?? '') === 'M5' && isDirectionalBias(String(item.bias ?? '')));
  const ltfEntryTimeframe: 'M15' | 'M5' = m5Ready || input.tradingStyle === 'scalp' ? 'M5' : 'M15';

  return {
    active,
    htfRanging: htfRanging || phaseRanging || mtfBiasRanging || regimeRanging || planRanging,
    htfTimeframesRanging,
    ltfEntryTimeframe,
    preferredTradingStyle: ltfEntryTimeframe === 'M5' ? 'scalp' : 'intraday',
    reasons,
  };
}

export function isGoldLtfScalpDecision(
  decision: Pick<
    AutonomousDecisionOutput,
    'symbol' | 'tradingStyle' | 'timeframe' | 'institutionalPlan' | 'regimeClassification' | 'selectedStrategyId' | 'setupType'
  >,
): boolean {
  if (!isGoldSymbol(decision.symbol)) return false;
  const plan = decision.institutionalPlan;
  if (plan?.rangingContextActive && (decision.tradingStyle === 'scalp' || ['M5', 'M15', 'M1'].includes(String(decision.timeframe ?? '').toUpperCase()))) {
    return true;
  }
  return isRangeOrientedContext(decision) && (decision.tradingStyle === 'scalp' || String(decision.timeframe ?? '').toUpperCase() === 'M5');
}

export function resolveGoldMinQualityForDecision(
  decision: Pick<
    AutonomousDecisionOutput,
    'symbol' | 'tradingStyle' | 'timeframe' | 'institutionalPlan' | 'regimeClassification' | 'selectedStrategyId' | 'setupType'
  >,
  defaultMin: number,
): number {
  if (!isGoldLtfScalpDecision(decision) && !decision.institutionalPlan?.rangingContextActive) return defaultMin;
  return Math.min(defaultMin, goldScalpMinInstitutionalQuality());
}

export function resolveGoldRewardRiskFloorForDecision(
  decision: Pick<
    AutonomousDecisionOutput,
    'symbol' | 'tradingStyle' | 'timeframe' | 'institutionalPlan' | 'regimeClassification' | 'selectedStrategyId' | 'setupType'
  >,
  defaultFloor: number,
): number {
  if (!isGoldLtfScalpDecision(decision) && !decision.institutionalPlan?.rangingContextActive) return defaultFloor;
  return Math.min(defaultFloor, goldScalpMinRewardRisk());
}
