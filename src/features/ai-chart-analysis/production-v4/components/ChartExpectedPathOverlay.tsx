import { useEffect, useMemo, useState } from 'react';
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';
import { buildExpectedPathPrices } from '../chartExpectedPath';
import { logicalXAt, priceY } from '../chartOverlayCoords';
import type { AnalysisResult, Timeframe } from '../types';

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  a: AnalysisResult;
  tf: Timeframe;
  candleCount: number;
  visible: boolean;
};

function catmullRomPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

export function ChartExpectedPathOverlay({ chart, series, a, tf, candleCount, visible }: Props) {
  const [d, setD] = useState('');
  const prices = useMemo(() => buildExpectedPathPrices(a, tf), [a, tf]);

  useEffect(() => {
    if (!visible || !chart || !series || prices.length < 2 || candleCount < 2) {
      setD('');
      return;
    }

    const sync = () => {
      const start = candleCount - 1;
      const ahead = 24;
      const step = ahead / Math.max(1, prices.length - 1);
      const px: { x: number; y: number }[] = [];
      for (let i = 0; i < prices.length; i++) {
        const logical = start + i * step;
        const x = logicalXAt(chart, logical);
        const y = priceY(series, prices[i]!);
        if (x == null || y == null) continue;
        px.push({ x, y });
      }
      setD(px.length >= 2 ? catmullRomPath(px) : '');
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
  }, [visible, chart, series, prices, candleCount]);

  if (!visible || !d) return null;

  return (
    <svg className="chartExpectedPath" aria-hidden>
      <path d={d} fill="none" stroke="#1ed7d0" strokeWidth={2} strokeDasharray="8 5" />
    </svg>
  );
}

export function applyChartVisibleRangeWithProjection(
  chart: IChartApi,
  candleCount: number,
  barsBack: number,
  logicalAhead = 26,
) {
  const back = Math.min(candleCount - 1, Math.max(30, barsBack));
  chart.timeScale().applyOptions({ rightOffset: 16 });
  chart.timeScale().setVisibleLogicalRange({
    from: (candleCount - back) as Logical,
    to: (candleCount - 1 + logicalAhead) as Logical,
  });
}
