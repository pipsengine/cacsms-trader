import { useEffect, useMemo, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { logicalX, priceY } from '../chartOverlayCoords';
import type { AnalysisResult } from '../types';

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  a: AnalysisResult;
  candleCount: number;
  digits: number;
  visible: boolean;
};

type Tag = { left: number; top: number; text: string; kind: 'inv' | 't1' | 't2' | 'p2' | 'pivot'; pivotNum?: number };

function fmt(price: number, digits: number) {
  return price.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function spreadPivots(a: AnalysisResult, candleCount: number) {
  const swings = [...a.annotations]
    .filter(
      (x) =>
        x.timeIndex >= 0 &&
        x.timeIndex < candleCount &&
        /^(HIGH|LOW)$/i.test(String(x.kind).trim()),
    )
    .sort((x, y) => x.timeIndex - y.timeIndex);
  const pool = swings.length >= 3 ? swings.slice(-3) : swings;
  if (pool.length >= 3) {
    return pool.map((p, i) => ({ ...p, num: (i + 3) as 3 | 4 | 5 }));
  }
  const ranked = [...a.annotations]
    .filter((x) => x.timeIndex >= 0 && x.timeIndex < candleCount)
    .sort((x, y) => x.timeIndex - y.timeIndex);
  const structure = ranked.filter((r) => /HIGH|LOW|BOS|CHOCH|SWING|PIVOT/i.test(r.kind));
  const fallback = structure.length >= 3 ? structure : ranked;
  if (fallback.length >= 3) {
    const a0 = fallback[0]!;
    const a1 = fallback[Math.floor(fallback.length / 2)]!;
    const a2 = fallback[fallback.length - 1]!;
    return [
      { ...a0, num: 3 as const },
      { ...a1, num: 4 as const },
      { ...a2, num: 5 as const },
    ];
  }
  const idx = [0.42, 0.58, 0.72].map((r) => Math.floor(candleCount * r));
  return idx.map((timeIndex, i) => {
    const c = a.candles[timeIndex];
    return {
      timeIndex,
      price: c?.close ?? a.ohlc.c,
      kind: 'SWING',
      num: (i + 3) as 3 | 4 | 5,
    };
  });
}

function separateTargetTags(tags: Tag[]): Tag[] {
  const pivots = tags.filter((t) => t.kind === 'pivot');
  const rest = tags.filter((t) => t.kind !== 'pivot');
  const minPivotX = pivots.length ? Math.min(...pivots.map((p) => p.left)) : 0;
  return rest.map((t) => {
    if (t.kind !== 't1' && t.kind !== 't2') return t;
    if (t.left < minPivotX + 40) {
      return { ...t, left: Math.max(t.left + 56, minPivotX + 44) };
    }
    return t;
  });
}

export function ChartThesisOverlay({ chart, series, a, candleCount, digits, visible }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const bull = a.direction === 'BULLISH';

  const pivots = useMemo(() => spreadPivots(a, candleCount), [a, candleCount]);

  useEffect(() => {
    if (!visible || !chart || !series) {
      setTags([]);
      return;
    }

    const sync = () => {
      const { levels } = a;
      const next: Tag[] = [];
      const inv = priceY(series, levels.invalidation);

      const xTag = logicalX(chart, Math.floor(candleCount * 0.93), candleCount);
      const yt1 = priceY(series, levels.t1);
      const yt2 = priceY(series, levels.t2);
      const yp2 = priceY(series, levels.p2);
      if (xTag != null && yt1 != null) {
        next.push({ left: xTag, top: yt1 - 14, text: `T1 ${fmt(levels.t1, digits)}`, kind: 't1' });
      }
      if (xTag != null && yt2 != null) {
        next.push({ left: xTag, top: yt2 - 14, text: `T2 ${fmt(levels.t2, digits)}`, kind: 't2' });
      }
      const xP2 = logicalX(chart, Math.floor(candleCount * 0.68), candleCount);
      if (xP2 != null && yp2 != null) {
        next.push({ left: xP2, top: yp2 - 18, text: 'P2 Break', kind: 'p2' });
      }
      const xInv = logicalX(chart, Math.floor(candleCount * 0.62), candleCount);
      if (xInv != null && inv != null) {
        next.push({
          left: Math.max(12, xInv),
          top: bull ? inv + 10 : inv - 32,
          text: `Invalidation ${fmt(levels.invalidation, digits)}`,
          kind: 'inv',
        });
      }

      for (const p of pivots) {
        const x = logicalX(chart, p.timeIndex, candleCount);
        const y = priceY(series, p.price);
        if (x == null || y == null) continue;
        next.push({
          left: x - 11,
          top: y - 11,
          text: String(p.num),
          kind: 'pivot',
          pivotNum: p.num,
        });
      }
      setTags(separateTargetTags(next));
    };

    sync();
    chart.timeScale().subscribeVisibleLogicalRangeChange(sync);
    const ro = new ResizeObserver(sync);
    const el = chart.chartElement().parentElement;
    if (el) ro.observe(el);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(sync);
      ro.disconnect();
    };
  }, [a, bull, candleCount, chart, digits, pivots, series, visible]);

  if (!visible) return null;

  const invTag = tags.find((t) => t.kind === 'inv');
  const invTop = invTag?.top ?? null;

  return (
    <div className="chartThesisLayer" aria-hidden>
      {invTop != null && (
        <div className="chartInvArrow" style={{ top: invTop - 6, right: 8, left: 'auto' }} aria-hidden />
      )}
      {tags.map((t) => (
        <div
          key={`${t.kind}-${t.left}-${t.top}-${t.text}`}
          className={`chartThesisTag ${t.kind}${
            t.kind === 'pivot' ? (t.pivotNum === 3 ? ' pivotRed' : ' pivotBlue') : ''
          }`}
          style={{ left: t.left, top: t.top }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
