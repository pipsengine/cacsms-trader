import type { Candle } from './types';

/** Lightweight Charts expects UTCTimestamp (seconds). Engine payloads often use ms. */
export function toChartTimeSeconds(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export type ValidCandle = Candle & {
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Lightweight Charts requires strictly ascending unique times per series. */
export function ensureStrictAscTimes<T extends { time: number; value: number }>(points: T[]): T[] {
  if (points.length < 2) return points;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const out: T[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prevT = out[out.length - 1]!.time;
    if (p.time <= prevT) {
      out.push({ ...p, time: prevT + 1 });
    } else {
      out.push(p);
    }
  }
  return out;
}

export function normalizeCandles(raw: Candle[]): ValidCandle[] {
  const out: ValidCandle[] = [];
  for (const c of raw) {
    const open = finiteNumber(c.open);
    const high = finiteNumber(c.high);
    const low = finiteNumber(c.low);
    const close = finiteNumber(c.close);
    if (open === null || high === null || low === null || close === null) continue;
    if (high < low) continue;
    const vol = finiteNumber(c.volume) ?? Math.max(1, Math.abs(high - low) * 100);
    out.push({
      ...c,
      open,
      high,
      low,
      close,
      volume: vol,
      closed: c.closed !== false,
    });
  }
  return out;
}

export function finiteLevels(levels: {
  erz: [number, number];
  supply: [number, number];
  p2: number;
  invalidation: number;
  t1: number;
  t2: number;
}): typeof levels | null {
  const erz: [number, number] = [finiteNumber(levels.erz[0]), finiteNumber(levels.erz[1])] as [number, number];
  const supply: [number, number] = [finiteNumber(levels.supply[0]), finiteNumber(levels.supply[1])] as [
    number,
    number,
  ];
  const p2 = finiteNumber(levels.p2);
  const invalidation = finiteNumber(levels.invalidation);
  const t1 = finiteNumber(levels.t1);
  const t2 = finiteNumber(levels.t2);
  if (erz.some((v) => v === null) || supply.some((v) => v === null)) return null;
  if (p2 === null || invalidation === null || t1 === null || t2 === null) return null;
  return {
    erz: erz as [number, number],
    supply: supply as [number, number],
    p2,
    invalidation,
    t1,
    t2,
  };
}

export type ChartScale = {
  minPrice: number;
  maxPrice: number;
  range: number;
  priceToY: (price: unknown) => number | null;
  indexToX: (index: number) => number;
};

export function buildChartScale(
  candles: ValidCandle[],
  extraPrices: unknown[],
  layout: { W: number; H: number; pad: { l: number; r: number; t: number; b: number } },
): ChartScale | null {
  if (candles.length < 2) return null;

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const extras = extraPrices.map(finiteNumber).filter((v): v is number => v !== null);

  let minPrice = Math.min(...lows, ...(extras.length ? extras : lows));
  let maxPrice = Math.max(...highs, ...(extras.length ? extras : highs));

  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return null;

  if (maxPrice <= minPrice) {
    const mid = (maxPrice + minPrice) / 2 || 1;
    minPrice = mid - 0.5;
    maxPrice = mid + 0.5;
  }

  const range = maxPrice - minPrice;
  const chartHeight = layout.H - layout.pad.t - layout.pad.b;
  const chartWidth = layout.W - layout.pad.l - layout.pad.r;
  const n = candles.length;

  const priceToY = (price: unknown): number | null => {
    const p = finiteNumber(price);
    if (p === null) return null;
    const y = layout.pad.t + ((maxPrice - p) / range) * chartHeight;
    return Number.isFinite(y) ? y : null;
  };

  const indexToX = (index: number): number => {
    const i = Math.max(0, Math.min(n - 1, index));
    return layout.pad.l + (i * chartWidth) / (n - 1);
  };

  return { minPrice, maxPrice, range, priceToY, indexToX };
}

export function priceTicks(minPrice: number, maxPrice: number, steps = 8): number[] {
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return [];
  const range = maxPrice - minPrice || 1;
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = minPrice + (range * i) / steps;
    if (Number.isFinite(p)) out.push(p);
  }
  return out;
}
