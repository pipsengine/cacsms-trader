import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';

export function normalizeAutonomousSnapshot(raw: AutonomousSnapshot): AutonomousSnapshot {
  if (!raw?.symbol || !raw.chart?.candles?.length) throw new Error('Invalid autonomous snapshot');
  const candles = raw.chart.candles
    .map((c) => ({
      time: +c.time,
      open: +c.open,
      high: +c.high,
      low: +c.low,
      close: +c.close,
      volume: +c.volume || 0,
    }))
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
  if (!candles.length) throw new Error('No finite OHLC candles');
  return { ...raw, chart: { ...raw.chart, candles } };
}

export function priceDecimals(symbol: string, price: number): number {
  if (/JPY$/.test(symbol)) return 3;
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 2;
  if (Math.abs(price) < 10) return 5;
  return 2;
}

export function formatPrice(symbol: string, price: number): string {
  if (!Number.isFinite(+price)) return '—';
  const d = priceDecimals(symbol, +price);
  return (+price).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function buildSafePriceDomain(
  symbol: string,
  candles: Array<{ low: number; high: number }>,
  overlays: number[] = [],
): { min: number; max: number; rejected: number[] } {
  void symbol;
  const lows = candles.map((c) => c.low).filter(Number.isFinite);
  const highs = candles.map((c) => c.high).filter(Number.isFinite);
  const baseMin = Math.min(...lows);
  const baseMax = Math.max(...highs);
  const baseRange = Math.max(baseMax - baseMin, Math.abs(baseMax) * 0.0005, 1e-8);
  const plausible = overlays
    .map(Number)
    .filter(Number.isFinite)
    .filter((p) => p >= baseMin - baseRange * 2.5 && p <= baseMax + baseRange * 2.5);
  const lo = Math.min(baseMin, ...plausible);
  const hi = Math.max(baseMax, ...plausible);
  const range = Math.max(hi - lo, baseRange);
  return {
    min: lo - range * 0.08,
    max: hi + range * 0.08,
    rejected: overlays.filter((p) => Number.isFinite(+p) && !plausible.includes(+p)),
  };
}
