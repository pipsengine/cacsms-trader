import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { isGoldSymbol } from '@/lib/gold-trading-engine';
import {
  INSTITUTIONAL_MACRO_HTF,
  INSTITUTIONAL_STRUCTURE_HTF,
} from '@/lib/institutional-top-down-timeframes';

export function isGoldMacroTrendFollowerEnabled(): boolean {
  const value = String(process.env.CACSMS_GOLD_MACRO_TREND_FOLLOWER_ENABLED ?? 'true').toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}

/** When false, scalp/range overrides cannot trade against MN/W macro bias. */
export function isGoldScalpCounterTrendAllowed(): boolean {
  const value = String(process.env.CACSMS_GOLD_ALLOW_SCALP_COUNTER_TREND ?? 'false').toLowerCase();
  return value === 'true' || value === '1' || value === 'on';
}

export type MacroDirection = 'bullish' | 'bearish' | 'neutral';

export function directionalBiasText(value: string): MacroDirection {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('bull') || text.includes('buy') || text.includes('long')) return 'bullish';
  if (text.includes('bear') || text.includes('sell') || text.includes('short')) return 'bearish';
  return 'neutral';
}

export function sideAlignedWithMacroBias(side: string, bias: MacroDirection): boolean {
  if (bias === 'neutral') return true;
  const s = side.toUpperCase();
  if (s === 'BUY') return bias === 'bullish';
  if (s === 'SELL') return bias === 'bearish';
  return true;
}

type BiasCarrier = { bias?: string; timeframe?: string };

export function resolveMacroBiasFromStates(
  states: readonly BiasCarrier[],
  fallback = 'neutral',
): MacroDirection {
  for (const tf of INSTITUTIONAL_MACRO_HTF) {
    const state = states.find((item) => String(item.timeframe ?? '').toUpperCase() === tf);
    const dir = directionalBiasText(String(state?.bias ?? ''));
    if (dir !== 'neutral') return dir;
  }
  return directionalBiasText(fallback);
}

export function resolveStructureBiasFromStates(
  states: readonly BiasCarrier[],
  fallback = 'neutral',
): MacroDirection {
  for (const tf of INSTITUTIONAL_STRUCTURE_HTF) {
    const state = states.find((item) => String(item.timeframe ?? '').toUpperCase() === tf);
    const dir = directionalBiasText(String(state?.bias ?? ''));
    if (dir !== 'neutral') return dir;
  }
  return directionalBiasText(fallback);
}

export function planStageBiasForTimeframes(
  plan: NonNullable<AutonomousDecisionOutput['institutionalPlan']>,
  timeframes: readonly string[],
): string {
  for (const tf of timeframes) {
    const stage = plan.sequence.find((item) => String(item.timeframe ?? '').toUpperCase() === tf);
    if (stage?.bias && !isNonDirectional(stage.bias)) return stage.bias;
  }
  return plan.htfBias ?? 'neutral';
}

function isNonDirectional(bias: string): boolean {
  const text = bias.toLowerCase();
  return text.includes('neutral') || text.includes('range') || text.includes('mixed') || text.includes('unknown');
}

export function macroTrendBlocksDecision(input: {
  symbol: string;
  decision: string;
  institutionalPlan?: AutonomousDecisionOutput['institutionalPlan'] | null;
  reversalConfirmed?: boolean;
  rangingContext?: boolean;
  scalpActive?: boolean;
}): string | null {
  if (!isGoldSymbol(input.symbol) || !isGoldMacroTrendFollowerEnabled()) return null;
  if (input.decision !== 'BUY' && input.decision !== 'SELL') return null;

  const plan = input.institutionalPlan;
  if (!plan) return 'Macro trend follower requires institutional top-down plan.';

  const macroBias = directionalBiasText(planStageBiasForTimeframes(plan, INSTITUTIONAL_MACRO_HTF));
  if (macroBias === 'neutral') return null;

  if (sideAlignedWithMacroBias(input.decision, macroBias)) return null;
  if (input.reversalConfirmed) return null;
  if (input.rangingContext && input.scalpActive && isGoldScalpCounterTrendAllowed()) return null;

  const label = macroBias === 'bearish' ? 'bearish' : 'bullish';
  return `Macro trend follower: ${input.decision} blocked — MN/W macro bias is ${label} (trend is your friend).`;
}

export function macroTrendGateSummary(plan: NonNullable<AutonomousDecisionOutput['institutionalPlan']>): {
  macroBias: MacroDirection;
  structureBias: MacroDirection;
  directionalBias: MacroDirection;
} {
  let macroBias = directionalBiasText(planStageBiasForTimeframes(plan, INSTITUTIONAL_MACRO_HTF));
  if (macroBias === 'neutral') {
    macroBias = directionalBiasText(plan.htfBias ?? '');
  }
  const structureBias = directionalBiasText(planStageBiasForTimeframes(plan, INSTITUTIONAL_STRUCTURE_HTF));
  const directionalBias = macroBias !== 'neutral' ? macroBias : structureBias;
  return { macroBias, structureBias, directionalBias };
}
