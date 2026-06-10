'use client';

import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';

type CaptureChartPreviewProps = {
  candles: ReconstructedCandle[];
  label?: string;
  className?: string;
  aspectClassName?: string;
};

export function CaptureChartPreview(props: CaptureChartPreviewProps) {
  const width = 760;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 24, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const prices = useMemo(
    () => props.candles.flatMap((item) => [item.highPrice, item.lowPrice]),
    [props.candles],
  );

  if (props.candles.length === 0) {
    return (
      <div className={cn('flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500', props.className, props.aspectClassName ?? 'aspect-video')}>
        {props.label ? `${props.label} — no reconstructed candles` : 'No reconstructed candles'}
      </div>
    );
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = Math.max(0.0001, maxPrice - minPrice);
  const candleWidth = Math.max(3, Math.min(12, plotWidth / Math.max(1, props.candles.length) - 2));
  const yForPrice = (price: number) => padding.top + ((maxPrice - price) / priceRange) * plotHeight;
  const xForIndex = (index: number) => padding.left + (index + 0.5) * (plotWidth / props.candles.length);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white', props.className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-full w-full', props.aspectClassName ?? 'min-h-[180px]')}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const price = minPrice + priceRange * (1 - ratio);
          const y = padding.top + plotHeight * ratio;
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={8} y={y + 4} fontSize="10" fill="#64748b">{price.toFixed(price < 10 ? 4 : 2)}</text>
            </g>
          );
        })}
        {props.candles.map((candle) => {
          const x = xForIndex(candle.candleIndex);
          const openY = yForPrice(candle.openPrice);
          const closeY = yForPrice(candle.closePrice);
          const highY = yForPrice(candle.highPrice);
          const lowY = yForPrice(candle.lowPrice);
          const bullish = candle.closePrice >= candle.openPrice;
          const color = bullish ? '#059669' : '#e11d48';
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));

          return (
            <g key={candle.candleIndex}>
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.5" />
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                opacity={0.92}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
