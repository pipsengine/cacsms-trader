import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { logicalX, priceY } from '../chartOverlayCoords';
import type { AnalysisResult } from '../types';

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  candles: AnalysisResult['candles'];
  supertrend: AnalysisResult['supertrendSeries'];
  candleCount: number;
  visible: boolean;
};

function stAtTime(st: NonNullable<AnalysisResult['supertrendSeries']>, time: number, fallback: number) {
  for (let i = st.length - 1; i >= 0; i--) {
    const p = st[i]!;
    if (p.time <= time) return p.value;
  }
  return fallback;
}

function stDirAtTime(st: NonNullable<AnalysisResult['supertrendSeries']>, time: number) {
  for (let i = st.length - 1; i >= 0; i--) {
    const p = st[i]!;
    if (p.time <= time) {
      const d = (p.direction || '').toUpperCase();
      return d === 'DOWN' || d === 'BEARISH' ? 'DOWN' : 'UP';
    }
  }
  return 'UP';
}

export function ChartSupertrendShade({ chart, series, candles, supertrend, candleCount, visible }: Props) {
  const [paths, setPaths] = useState<{ d: string; tone: 'up' | 'down' }[]>([]);

  useEffect(() => {
    if (!visible || !chart || !series || !supertrend?.length || candleCount < 3) {
      setPaths([]);
      return;
    }

    const sync = () => {
      const start = Math.max(0, candleCount - 90);
      const segments: { tone: 'up' | 'down'; upper: string[]; lower: string[] }[] = [];
      let cur: (typeof segments)[number] | null = null;

      for (let i = start; i < candleCount; i++) {
        const c = candles[i];
        if (!c) continue;
        const stVal = stAtTime(supertrend, c.time, c.close);
        const tone = stDirAtTime(supertrend, c.time) === 'DOWN' ? 'down' : 'up';
        const x = logicalX(chart, i, candleCount);
        const yClose = priceY(series, c.close);
        const ySt = priceY(series, stVal);
        if (x == null || yClose == null || ySt == null) continue;

        if (!cur || cur.tone !== tone) {
          if (cur && cur.upper.length >= 2) segments.push(cur);
          cur = { tone, upper: [`M ${x} ${ySt}`], lower: [] };
        } else {
          cur.upper.push(`L ${x} ${ySt}`);
        }
        cur.lower.unshift(`L ${x} ${yClose}`);
      }
      if (cur && cur.upper.length >= 2) segments.push(cur);

      setPaths(
        segments.map((s) => ({
          tone: s.tone,
          d: `${s.upper.join(' ')} ${s.lower.join(' ')} Z`,
        })),
      );
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
  }, [visible, chart, series, candles, supertrend, candleCount]);

  if (!visible || !paths.length) return null;

  return (
    <svg className="chartSupertrendShade" aria-hidden>
      {paths.map((p, i) => (
        <path
          key={`${p.tone}-${i}`}
          d={p.d}
          fill={p.tone === 'down' ? 'rgba(239,91,106,0.14)' : 'rgba(24,185,129,0.14)'}
          stroke="none"
        />
      ))}
    </svg>
  );
}
