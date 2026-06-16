import { GOLD_SYMBOL, isGoldOnlyTradingEngine } from '@/lib/gold-trading-engine';

/**
 * Canonical focus universe — XAU/USD Gold only for the autonomous trading engine.
 */
export const SYSTEM_FOCUS_SYMBOLS = [GOLD_SYMBOL] as const;

/** Legacy multi-symbol list retained for reference / migration only. */
export const LEGACY_MULTI_SYMBOL_UNIVERSE = [
  'EURUSD', 'GBPUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'USDJPY', 'USDCAD', 'USDCHF',
  'AUDUSD', 'NZDUSD', 'AUDJPY', 'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD',
  'GBPCAD', 'AUDNZD', 'CADJPY', 'CHFJPY', 'NZDJPY', 'XAUUSD', 'XAGUSD', 'BTCUSD',
  'US30', 'UK100', 'NASDAQ100', 'SP500',
] as const;

export type SystemFocusSymbol = typeof SYSTEM_FOCUS_SYMBOLS[number];

export const SYSTEM_FOCUS_SYMBOL_COUNT = SYSTEM_FOCUS_SYMBOLS.length;

export const SYSTEM_FOCUS_SYMBOL_LABELS: Record<SystemFocusSymbol, string> = {
  XAUUSD: 'XAU/USD Gold',
};

export function isSystemFocusSymbol(symbol: string): symbol is SystemFocusSymbol {
  if (isGoldOnlyTradingEngine()) {
    return symbol.toUpperCase() === GOLD_SYMBOL || symbol.toUpperCase().startsWith('XAUUSD') || symbol.toUpperCase() === 'GOLD';
  }
  return (SYSTEM_FOCUS_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());
}
