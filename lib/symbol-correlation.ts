import { isContinuousTradingEnabled } from './execution-risk-limits';
import { parsePairCurrencies } from './pair-selector-utils';

/**
 * Institutional cluster correlation for continuous mode.
 * Blocks same-cluster exposure (e.g. JPY crosses together) while allowing
 * uncorrelated packs (EURUSD + NZDUSD + US30) to coexist.
 */
export function getInstitutionalCorrelationCluster(symbol: string): string {
  const normalized = symbol.toUpperCase();
  if (normalized.endsWith('JPY') && normalized.length >= 6) return 'jpy_cross';
  if (normalized.startsWith('EUR')) return 'eur_pack';
  if (normalized.startsWith('GBP')) return 'gbp_pack';
  if (normalized.startsWith('AUD')) return 'aud_pack';
  if (normalized.startsWith('NZD')) return 'nzd_pack';
  if (normalized.startsWith('XAU') || normalized.startsWith('XAG')) return 'commodity_metal';
  if (normalized.startsWith('BTC') || normalized.startsWith('ETH')) return 'crypto';
  if (['US30', 'NASDAQ100', 'NAS100', 'SP500', 'SPX500', 'US500'].includes(normalized)) return 'us_index';
  if (normalized.startsWith('USD')) return 'usd_quote';
  return `other_${normalized}`;
}

export function sharesInstitutionalCorrelation(symbolA: string, symbolB: string): boolean {
  const a = symbolA.toUpperCase();
  const b = symbolB.toUpperCase();
  if (a === b) return true;
  return getInstitutionalCorrelationCluster(a) === getInstitutionalCorrelationCluster(b);
}

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

export function findCorrelatedOpenSymbol(
  candidateSymbol: string,
  openSymbols: string[],
  options?: { excludeSameSymbol?: boolean; continuousMode?: boolean },
): string | null {
  const normalized = candidateSymbol.toUpperCase();
  const useCluster = options?.continuousMode ?? isContinuousTradingEnabled();
  for (const open of openSymbols) {
    const openNorm = open.toUpperCase();
    if (options?.excludeSameSymbol && openNorm === normalized) continue;
    const correlated = useCluster
      ? sharesInstitutionalCorrelation(normalized, openNorm)
      : sharesCurrencyExposure(normalized, openNorm);
    if (correlated) return openNorm;
  }
  return null;
}
