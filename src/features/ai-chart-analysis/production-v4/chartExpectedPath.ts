import type { UTCTimestamp } from 'lightweight-charts';
import { normalizeCandles } from './chartMath';
import type { AnalysisResult, Timeframe } from './types';

const TF_SEC: Record<Timeframe, number> = {
  YTD: 86400,
  Q: 86400,
  MN: 86400,
  W: 86400,
  D1: 86400,
  H8: 28800,
  H1: 3600,
  M15: 900,
  M5: 300,
};

function narrativeKnots(a: AnalysisResult): number[] {
  const cs = normalizeCandles(a.candles);
  if (cs.length < 2) return [];
  const last = cs[cs.length - 1]!;
  const bull = a.direction === 'BULLISH';
  const { levels } = a;

  const erzTop = Math.max(levels.erz[0], levels.erz[1]);
  const erzBot = Math.min(levels.erz[0], levels.erz[1]);
  const erzMid = (erzTop + erzBot) / 2;
  const supplyMid = (Math.max(levels.supply[0], levels.supply[1]) + Math.min(levels.supply[0], levels.supply[1])) / 2;

  const erzTouch = bull ? erzBot : erzTop;
  const pullback = bull
    ? last.close - Math.min(Math.abs(last.close - erzTouch) * 0.45, Math.abs(last.close - erzMid) * 0.7)
    : last.close + Math.min(Math.abs(supplyMid - last.close) * 0.35, Math.abs(last.close - erzMid) * 0.55);

  const reaction = bull
    ? erzMid + (levels.p2 - erzMid) * 0.32
    : erzMid - (erzMid - levels.p2) * 0.28;
  const retest = bull
    ? levels.p2 - Math.abs(levels.p2 - reaction) * 0.18
    : levels.p2 + Math.abs(reaction - levels.p2) * 0.18;

  const t1 = bull ? Math.max(levels.t1, levels.p2) : Math.min(levels.t1, levels.p2);
  const t2 = bull ? Math.max(levels.t2, t1 + 1e-9) : Math.min(levels.t2, t1 - 1e-9);

  if (bull) {
    return [
      last.close,
      pullback,
      erzTouch,
      erzMid,
      reaction,
      levels.p2,
      retest,
      t1,
      t2,
    ];
  }
  return [
    last.close,
    pullback,
    supplyMid,
    reaction,
    levels.p2,
    retest,
    erzMid,
    t1,
    t2,
  ];
}

/** ERZ → reaction → BOS/P2 → retest → T1 → T2 (for legacy LWC series if needed). */
export function buildExpectedPathPoints(
  a: AnalysisResult,
  tf: Timeframe,
): { time: UTCTimestamp; value: number }[] {
  const cs = normalizeCandles(a.candles);
  if (cs.length < 2) return [];
  const step = TF_SEC[tf] || 3600;
  const t0 = cs[cs.length - 1]!.time;
  const prices = narrativeKnots(a);
  return prices.map((value, i) => ({
    time: (t0 + step * (i + 1)) as UTCTimestamp,
    value,
  }));
}

/** Price knots for SVG overlay (one point per narrative step — no duplicate start). */
export function buildExpectedPathPrices(a: AnalysisResult, _tf: Timeframe): number[] {
  return narrativeKnots(a);
}
