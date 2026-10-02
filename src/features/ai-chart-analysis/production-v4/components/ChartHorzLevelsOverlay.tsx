import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { priceY } from '../chartOverlayCoords';
import type { AnalysisResult } from '../types';

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  levels: AnalysisResult['levels'];
  showP2: boolean;
  showInvalidation: boolean;
};

/** Full-width horizontal guides like the reference (P2 white dashed, invalidation solid red). */
export function ChartHorzLevelsOverlay({ chart, series, levels, showP2, showInvalidation }: Props) {
  const [p2Y, setP2Y] = useState<number | null>(null);
  const [invY, setInvY] = useState<number | null>(null);

  useEffect(() => {
    if (!chart || !series) {
      setP2Y(null);
      setInvY(null);
      return;
    }
    const sync = () => {
      if (showP2) setP2Y(priceY(series, levels.p2));
      else setP2Y(null);
      if (showInvalidation) setInvY(priceY(series, levels.invalidation));
      else setInvY(null);
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
  }, [chart, series, levels, showInvalidation, showP2]);

  return (
    <div className="chartHorzLevels" aria-hidden>
      {p2Y != null && <div className="chartP2Line" style={{ top: p2Y }} />}
      {invY != null && <div className="chartInvLine chartInvLineSolid" style={{ top: invY }} />}
    </div>
  );
}
