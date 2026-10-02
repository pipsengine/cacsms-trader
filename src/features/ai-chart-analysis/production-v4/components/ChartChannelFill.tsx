import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { logicalX, priceY } from '../chartOverlayCoords';
import type { AnalysisResult } from '../types';

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  lines: AnalysisResult['chartLines'];
  candleTimes: number[];
  candleCount: number;
  visible: boolean;
};

function indexForTime(candleTimes: number[], t: number): number {
  for (let i = candleTimes.length - 1; i >= 0; i--) {
    if (candleTimes[i]! <= t) return i;
  }
  return 0;
}

export function ChartChannelFill({ chart, series, lines, candleTimes, candleCount, visible }: Props) {
  const [path, setPath] = useState('');

  useEffect(() => {
    if (!visible || !chart || !series || !lines?.length || candleCount < 2) {
      setPath('');
      return;
    }

    const sync = () => {
      const upper: string[] = [];
      const lower: string[] = [];
      lines.forEach((l, i) => {
        const idx = candleTimes.length ? indexForTime(candleTimes, l.time) : i;
        const x = logicalX(chart, idx, candleCount);
        const yU = priceY(series, l.upper);
        const yL = priceY(series, l.lower);
        if (x == null || yU == null || yL == null) return;
        upper.push(`${upper.length === 0 ? 'M' : 'L'} ${x} ${yU}`);
        lower.unshift(`L ${x} ${yL}`);
      });
      if (upper.length < 2) {
        setPath('');
        return;
      }
      setPath(`${upper.join(' ')} ${lower.join(' ')} Z`);
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
  }, [visible, chart, series, lines, candleTimes, candleCount]);

  if (!visible || !path) return null;

  return (
    <svg className="chartChannelFill" aria-hidden>
      <path d={path} fill="rgba(163,194,210,0.08)" stroke="none" />
    </svg>
  );
}
