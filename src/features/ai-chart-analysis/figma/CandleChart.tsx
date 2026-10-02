import { useEffect, useRef } from 'react';
import { CandlestickSeries, createChart, createSeriesMarkers, LineSeries, type UTCTimestamp } from 'lightweight-charts';
import type { AnalysisView } from './types';

export function CandleChart({ analysis }: { analysis: AnalysisView }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !analysis.candles.length) return;

    const height = Math.max(320, ref.current.clientHeight || 455);

    const chart = createChart(ref.current, {
      height,
      layout: { background: { color: '#07101d' }, textColor: '#8fa3bd' },
      grid: { vertLines: { color: '#122033' }, horzLines: { color: '#122033' } },
      rightPriceScale: { borderColor: '#24344a' },
      timeScale: { borderColor: '#24344a', timeVisible: true },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#18b981',
      downColor: '#ef5b6a',
      borderVisible: false,
      wickUpColor: '#18b981',
      wickDownColor: '#ef5b6a',
    });

    const finite = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    series.setData(
      analysis.candles
        .map((c) => {
          const open = finite(c.open);
          const high = finite(c.high);
          const low = finite(c.low);
          const close = finite(c.close);
          if (open === null || high === null || low === null || close === null) return null;
          return { time: c.time as UTCTimestamp, open, high, low, close };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null),
    );

    const lines = analysis.chartLines || [];
    if (lines.length) {
      const upper = chart.addSeries(LineSeries, { color: '#5b8cff', lineWidth: 1, lineStyle: 2 });
      const lower = chart.addSeries(LineSeries, { color: '#5b8cff', lineWidth: 1, lineStyle: 2 });
      upper.setData(lines.map((l) => ({ time: l.time as UTCTimestamp, value: l.upper })));
      lower.setData(lines.map((l) => ({ time: l.time as UTCTimestamp, value: l.lower })));
    }

    const inv = analysis.invalidation !== '—' ? Number(analysis.invalidation) : NaN;
    if (Number.isFinite(inv)) {
      const invLine = chart.addSeries(LineSeries, { color: '#ff5167', lineWidth: 2, lineStyle: 0, title: 'Invalidation' });
      const t0 = analysis.candles[0]?.time as UTCTimestamp;
      const t1 = analysis.candles[analysis.candles.length - 1]?.time as UTCTimestamp;
      invLine.setData([
        { time: t0, value: inv },
        { time: t1, value: inv },
      ]);
    }

    const markers = analysis.markers
      .filter((m) => m.time > 0)
      .map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        shape: m.shape,
        text: m.text,
        color: m.shape === 'arrowUp' ? '#36d399' : '#ff7383',
      }));

    if (markers.length) createSeriesMarkers(series, markers);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (!ref.current) return;
      chart.applyOptions({ width: ref.current.clientWidth, height: Math.max(320, ref.current.clientHeight) });
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [analysis]);

  if (!analysis.candles.length) {
    return <div className="aca-figma-empty">No closed-bar candles for this timeframe yet.</div>;
  }

  return <div className="chart" ref={ref} />;
}
