export function parsePairCurrencies(symbol: string): [string, string] {
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU')) return ['XAU', normalized.slice(3) || 'USD'];
  if (normalized.startsWith('XAG')) return ['XAG', normalized.slice(3) || 'USD'];
  if (normalized.startsWith('BTC')) return ['BTC', normalized.slice(3) || 'USD'];
  if (['US30', 'NASDAQ100', 'NAS100', 'USTEC', 'SP500', 'SPX500', 'US500', 'UK100'].includes(normalized)) return [normalized, 'USD'];
  if (normalized.length >= 6) return [normalized.slice(0, 3), normalized.slice(3)];
  return [normalized.slice(0, 3), normalized.slice(3)];
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
