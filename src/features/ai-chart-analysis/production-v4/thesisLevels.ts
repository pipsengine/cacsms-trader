import { finiteNumber, normalizeCandles } from './chartMath';
import type { AnalysisResult, Direction } from './types';

export type ThesisLevels = AnalysisResult['levels'];

/** Supply = upper band, ERZ/demand = lower band; invalidation and targets on correct side of thesis. */
export function canonicalizeThesisLevels(
  levels: ThesisLevels,
  direction: Direction,
  candles: AnalysisResult['candles'],
): ThesisLevels {
  const valid = normalizeCandles(candles);
  if (!valid.length) return levels;

  const closes = valid.map((c) => c.close);
  const highs = valid.map((c) => c.high);
  const lows = valid.map((c) => c.low);
  const last = closes[closes.length - 1] ?? 1;
  const maxH = Math.max(...highs, last);
  const minL = Math.min(...lows, last);
  const range = maxH - minL || Math.abs(last) * 0.01 || 1;

  let supply: [number, number] = [Math.max(levels.supply[0], levels.supply[1]), Math.min(levels.supply[0], levels.supply[1])];
  let erz: [number, number] = [Math.max(levels.erz[0], levels.erz[1]), Math.min(levels.erz[0], levels.erz[1])];
  const supplyMid = (supply[0] + supply[1]) / 2;
  const erzMid = (erz[0] + erz[1]) / 2;

  if (supplyMid <= erzMid) {
    supply = [maxH + range * 0.01, maxH - range * 0.06];
    erz = [minL + range * 0.06, minL - range * 0.03];
  }

  let invalidation = finiteNumber(levels.invalidation) ?? (direction === 'BULLISH' ? minL - range * 0.12 : maxH + range * 0.12);
  if (direction === 'BULLISH' && invalidation > erzMid) {
    invalidation = minL - range * 0.12;
  }
  if (direction === 'BEARISH' && invalidation < supplyMid) {
    invalidation = maxH + range * 0.12;
  }

  let t1 = finiteNumber(levels.t1) ?? (direction === 'BULLISH' ? last + range * 0.12 : last - range * 0.12);
  let t2 = finiteNumber(levels.t2) ?? (direction === 'BULLISH' ? last + range * 0.22 : last - range * 0.22);
  if (direction === 'BULLISH' && t1 > t2) [t1, t2] = [t2, t1];
  if (direction === 'BEARISH' && t1 < t2) [t1, t2] = [t2, t1];

  const p2 =
    finiteNumber(levels.p2) ??
    (direction === 'BULLISH' ? erz[0] + range * 0.02 : supply[1] - range * 0.02);

  return { supply, erz, p2, invalidation, t1, t2 };
}

export type ZoneBandLayout = {
  supply: { x0: number; x1: number };
  erz: { x0: number; x1: number };
};

/** Reference mockup: supply upper-left span, ERZ lower-right span. */
export function zoneBandLayout(_direction: Direction): ZoneBandLayout {
  return {
    supply: { x0: 0.06, x1: 0.78 },
    erz: { x0: 0.48, x1: 0.96 },
  };
}
