import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';

export type PixelRect = { left: number; top: number; width: number; height: number };

export function logicalBandRect(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  candleCount: number,
  priceTop: number,
  priceBottom: number,
  xStartRatio: number,
  xEndRatio: number,
): PixelRect | null {
  if (candleCount < 2) return null;
  const ts = chart.timeScale();
  const i0 = Math.max(0, Math.floor(candleCount * xStartRatio));
  const i1 = Math.min(candleCount - 1, Math.floor(candleCount * xEndRatio));
  const x0 = ts.logicalToCoordinate(i0 as Logical);
  const x1 = ts.logicalToCoordinate(i1 as Logical);
  const y0 = series.priceToCoordinate(Math.max(priceTop, priceBottom));
  const y1 = series.priceToCoordinate(Math.min(priceTop, priceBottom));
  if (x0 == null || x1 == null || y0 == null || y1 == null) return null;
  const left = Math.min(x0, x1);
  const width = Math.abs(x1 - x0);
  const top = Math.min(y0, y1);
  const height = Math.abs(y1 - y0);
  if (width < 2 || height < 2) return null;
  return { left, top, width, height };
}

export function priceY(series: ISeriesApi<'Candlestick'>, price: number): number | null {
  return series.priceToCoordinate(price);
}

export function logicalX(chart: IChartApi, index: number, candleCount: number): number | null {
  const i = Math.max(0, Math.min(candleCount - 1, index));
  return chart.timeScale().logicalToCoordinate(i as Logical);
}

/** Logical index may extend past last bar (projected path into right offset). */
export function logicalXAt(chart: IChartApi, logicalIndex: number): number | null {
  return chart.timeScale().logicalToCoordinate(logicalIndex as Logical);
}

export const PATH_LOGICAL_AHEAD = 22;
