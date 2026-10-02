import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { logicalBandRect, type PixelRect } from '../chartOverlayCoords';
import { zoneBandLayout } from '../thesisLevels';
import type { AnalysisResult, Timeframe } from '../types';

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  levels: AnalysisResult['levels'];
  candleCount: number;
  tf: Timeframe;
  direction: AnalysisResult['direction'];
  visible: boolean;
};

export function ChartZoneBands({ chart, series, levels, candleCount, tf, direction, visible }: Props) {
  const [supply, setSupply] = useState<PixelRect | null>(null);
  const [erz, setErz] = useState<PixelRect | null>(null);
  const layout = zoneBandLayout(direction);

  useEffect(() => {
    if (!visible || !chart || !series) {
      setSupply(null);
      setErz(null);
      return;
    }

    const sync = () => {
      setSupply(
        logicalBandRect(
          chart,
          series,
          candleCount,
          levels.supply[0],
          levels.supply[1],
          layout.supply.x0,
          layout.supply.x1,
        ),
      );
      setErz(
        logicalBandRect(chart, series, candleCount, levels.erz[0], levels.erz[1], layout.erz.x0, layout.erz.x1),
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
  }, [visible, chart, series, levels, candleCount, layout]);

  if (!visible) return null;

  const erzLabel = `${tf} ERZ / Demand`;

  return (
    <div className="chartZoneLayer" aria-hidden>
      {supply && (
        <div
          className="chartZone supply"
          style={{ left: supply.left, top: supply.top, width: supply.width, height: supply.height }}
        >
          <span>{tf} Supply</span>
        </div>
      )}
      {erz && (
        <div
          className={`chartZone demand ${direction === 'BEARISH' ? 'bear' : ''}`}
          style={{ left: erz.left, top: erz.top, width: erz.width, height: erz.height }}
        >
          <span>{erzLabel}</span>
        </div>
      )}
    </div>
  );
}
