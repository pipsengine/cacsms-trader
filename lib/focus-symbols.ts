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
  'XAUUSD',
  'BTCUSD',
  'US30',
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
  XAUUSD: 'XAU/USD',
  BTCUSD: 'BTC/USD',
  US30: 'US30',
  NASDAQ100: 'NASDAQ100',
  SP500: 'SP500',
};

export function isSystemFocusSymbol(symbol: string): symbol is SystemFocusSymbol {
  return (SYSTEM_FOCUS_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());
}
