import { AUTONOMY_TIMEFRAME_SEQUENCE } from '@/lib/autonomous-pipeline';
import { isGoldOnlyTradingEngine } from '@/lib/gold-trading-engine';

/** Monthly + weekly — macro directional permission ("trend is your friend"). */
export const GOLD_TOP_DOWN_MACRO = ['MN', 'W'] as const;

/** Daily + H4 — structure and pullback context inside macro control. */
export const GOLD_TOP_DOWN_STRUCTURE_HTF = ['D', 'H4'] as const;

/** Full directional stack checked before execution. */
export const GOLD_TOP_DOWN_DIRECTIONAL_HTF = ['MN', 'W', 'D', 'H4'] as const;

/** Legacy HTF gate alias — now includes macro + structure. */
export const GOLD_TOP_DOWN_HTF = [...GOLD_TOP_DOWN_DIRECTIONAL_HTF] as const;

/** Intermediate — setup formation and confirmation. */
export const GOLD_TOP_DOWN_INTERMEDIATE = ['H1', 'M30'] as const;

/** Execution — precise entries and scalping. */
export const GOLD_TOP_DOWN_EXECUTION = ['M15', 'M5', 'M1'] as const;

/** Full institutional Gold capture stack (MN anchor → M1 execution). */
export const GOLD_TOP_DOWN_CAPTURE_SEQUENCE = [
  'MN',
  'W',
  'D',
  'H4',
  'H1',
  'M30',
  'M15',
  'M5',
  'M1',
] as const;

export type GoldTopDownTier = 'macro' | 'htf' | 'intermediate' | 'execution';

export function goldTopDownTierForTimeframe(timeframe: string): GoldTopDownTier | null {
  const tf = timeframe.toUpperCase();
  if ((GOLD_TOP_DOWN_MACRO as readonly string[]).includes(tf)) return 'macro';
  if ((GOLD_TOP_DOWN_STRUCTURE_HTF as readonly string[]).includes(tf)) return 'htf';
  if ((GOLD_TOP_DOWN_INTERMEDIATE as readonly string[]).includes(tf)) return 'intermediate';
  if ((GOLD_TOP_DOWN_EXECUTION as readonly string[]).includes(tf)) return 'execution';
  return null;
}

/** Timeframes used for chart capture in the current engine mode. */
export function resolveCaptureTimeframeSequence(symbol?: string): readonly string[] {
  const upper = String(symbol ?? '').toUpperCase();
  if (isGoldOnlyTradingEngine() || upper.startsWith('XAU') || upper === 'GOLD') {
    return GOLD_TOP_DOWN_CAPTURE_SEQUENCE;
  }
  return AUTONOMY_TIMEFRAME_SEQUENCE;
}

/** Mandatory fresh captures for macro trend-following Gold execution. */
export function goldMandatoryCaptureTimeframes(scalpMode: boolean, ltfEntryTimeframe: 'M15' | 'M5' = 'M15'): string[] {
  const base = [
    ...GOLD_TOP_DOWN_MACRO,
    ...GOLD_TOP_DOWN_STRUCTURE_HTF,
    ...GOLD_TOP_DOWN_INTERMEDIATE,
    'M15',
  ];
  if (scalpMode) {
    base.push(ltfEntryTimeframe === 'M5' ? 'M5' : 'M15');
  }
  return [...new Set(base)];
}
