import { AUTONOMY_TIMEFRAME_SEQUENCE } from '@/lib/autonomous-pipeline';
import { isGoldOnlyTradingEngine } from '@/lib/gold-trading-engine';

/** Higher timeframe — trend, structure, liquidity, directional bias. */
export const GOLD_TOP_DOWN_HTF = ['D', 'H4'] as const;

/** Intermediate — setup formation and confirmation. */
export const GOLD_TOP_DOWN_INTERMEDIATE = ['H1', 'M30'] as const;

/** Execution — precise entries and scalping. */
export const GOLD_TOP_DOWN_EXECUTION = ['M15', 'M5', 'M1'] as const;

/** Full institutional Gold capture stack (W anchor + tier timeframes). */
export const GOLD_TOP_DOWN_CAPTURE_SEQUENCE = ['W', 'D', 'H4', 'H1', 'M30', 'M15', 'M5', 'M1'] as const;

export type GoldTopDownTier = 'htf' | 'intermediate' | 'execution';

export function goldTopDownTierForTimeframe(timeframe: string): GoldTopDownTier | null {
  const tf = timeframe.toUpperCase();
  if ((GOLD_TOP_DOWN_HTF as readonly string[]).includes(tf)) return 'htf';
  if ((GOLD_TOP_DOWN_INTERMEDIATE as readonly string[]).includes(tf)) return 'intermediate';
  if ((GOLD_TOP_DOWN_EXECUTION as readonly string[]).includes(tf)) return 'execution';
  if (tf === 'W') return 'htf';
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
