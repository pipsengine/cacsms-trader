import { parsePairCurrencies } from './pair-selector-utils';

/** True when two symbols share at least one currency leg (correlated FX exposure). */
export function sharesCurrencyExposure(symbolA: string, symbolB: string): boolean {
  const a = symbolA.toUpperCase();
  const b = symbolB.toUpperCase();
  if (a === b) return true;
  const currenciesA = getSymbolCurrencies(a);
  const currenciesB = getSymbolCurrencies(b);
  return currenciesA.some((currency) => currenciesB.includes(currency));
}

export function getSymbolCurrencies(symbol: string): string[] {
  const [base, quote] = parsePairCurrencies(symbol);
  return [base, quote].filter((item) => item.length >= 2);
}

export function findCorrelatedOpenSymbol(candidateSymbol: string, openSymbols: string[]): string | null {
  const normalized = candidateSymbol.toUpperCase();
  for (const open of openSymbols) {
    if (sharesCurrencyExposure(normalized, open)) return open.toUpperCase();
  }
  return null;
}
