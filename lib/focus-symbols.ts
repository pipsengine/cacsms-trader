/**
 * Canonical focus universe for autonomous scanning, scheduling, and pipeline operations.
 * Symbol names match common MT5 / IC Markets conventions.
 */
export const SYSTEM_FOCUS_SYMBOLS = [
  'EURUSD',
  'GBPUSD',
  'EURGBP',
  'EURJPY',
  'GBPJPY',
  'USDJPY',
  'USDCAD',
  'USDCHF',
  'AUDUSD',
  'NZDUSD',
  'AUDJPY',
  'EURAUD',
  'EURCAD',
  'EURCHF',
  'EURNZD',
  'GBPAUD',
  'GBPCAD',
  'AUDNZD',
  'CADJPY',
  'CHFJPY',
  'NZDJPY',
  'XAUUSD',
  'XAGUSD',
  'BTCUSD',
  'US30',
  'UK100',
  'NASDAQ100',
  'SP500',
] as const;

export type SystemFocusSymbol = typeof SYSTEM_FOCUS_SYMBOLS[number];

export const SYSTEM_FOCUS_SYMBOL_COUNT = SYSTEM_FOCUS_SYMBOLS.length;

export const SYSTEM_FOCUS_SYMBOL_LABELS: Record<SystemFocusSymbol, string> = {
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  EURGBP: 'EUR/GBP',
  EURJPY: 'EUR/JPY',
  GBPJPY: 'GBP/JPY',
  USDJPY: 'USD/JPY',
  USDCAD: 'USD/CAD',
  USDCHF: 'USD/CHF',
  AUDUSD: 'AUD/USD',
  NZDUSD: 'NZD/USD',
  AUDJPY: 'AUD/JPY',
  EURAUD: 'EUR/AUD',
  EURCAD: 'EUR/CAD',
  EURCHF: 'EUR/CHF',
  EURNZD: 'EUR/NZD',
  GBPAUD: 'GBP/AUD',
  GBPCAD: 'GBP/CAD',
  AUDNZD: 'AUD/NZD',
  CADJPY: 'CAD/JPY',
  CHFJPY: 'CHF/JPY',
  NZDJPY: 'NZD/JPY',
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  BTCUSD: 'BTC/USD',
  US30: 'US30',
  UK100: 'UK100',
  NASDAQ100: 'NASDAQ100',
  SP500: 'SP500',
};

export function isSystemFocusSymbol(symbol: string): symbol is SystemFocusSymbol {
  return (SYSTEM_FOCUS_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());
}
