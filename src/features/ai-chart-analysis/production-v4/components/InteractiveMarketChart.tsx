import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Camera, CandlestickChart, Expand, FlaskConical, Grid3x3 } from 'lucide-react';

import {

  CandlestickSeries,

  HistogramSeries,

  LineSeries,

  LineStyle,

  LineType,

  PriceScaleMode,

  createChart,

  createSeriesMarkers,

  type IChartApi,

  type ISeriesApi,

  type UTCTimestamp,

} from 'lightweight-charts';

import {
  ChartExpectedPathOverlay,
  applyChartVisibleRangeWithProjection,
} from './ChartExpectedPathOverlay';

import { DEFAULT_CHART_OVERLAYS, type ChartOverlayFlags } from '../chartOverlayFlags';

import { ensureStrictAscTimes, normalizeCandles } from '../chartMath';

import { useAcaLiveQuote } from '../useAcaLiveQuote';

import type { AnalysisResult, Timeframe } from '../types';

import { ChartChannelFill } from './ChartChannelFill';
import { ChartSupertrendShade } from './ChartSupertrendShade';
import { ChartHorzLevelsOverlay } from './ChartHorzLevelsOverlay';

import { ChartDrawOverlay, type UserDrawing } from './ChartDrawOverlay';

import { ChartDrawTools, type DrawTool } from './ChartDrawTools';

import { ChartIndicatorsMenu } from './ChartIndicatorsMenu';

import { ChartThesisOverlay } from './ChartThesisOverlay';

import { ChartZoneBands } from './ChartZoneBands';



const CHART_TFS: Timeframe[] = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'];

const RANGE_PRESETS = ['5Y', '1Y', '6M', '3M', '1M', '1W', '1D'] as const;



const ST_UP = '#18b981';

const ST_DOWN = '#ef5b6a';

const CHANNEL = '#e8eef5';

const silentLine = {

  lastValueVisible: false,

  priceLineVisible: false,

  title: '',

  crosshairMarkerVisible: true,

};



function markerShape(kind: string): 'arrowUp' | 'arrowDown' | 'circle' {

  const k = kind.toUpperCase();

  if (k.includes('BOS') || k.includes('BREAK')) return 'arrowUp';

  if (k.includes('CHOCH')) return 'arrowDown';

  if (k.includes('RETEST')) return 'arrowUp';

  return 'circle';

}



function markerColor(kind: string, tone: string): string {

  const k = kind.toUpperCase();

  if (k.includes('BOS')) return '#5b9cff';

  if (k.includes('CHOCH')) return '#ff7383';

  if (tone === 'bad') return '#ff7383';

  if (tone === 'good') return '#36d399';

  return '#8eb4ff';

}



function stSegments(series: NonNullable<AnalysisResult['supertrendSeries']>) {

  const segs: { dir: string; points: { time: UTCTimestamp; value: number }[] }[] = [];

  let cur: (typeof segs)[number] | null = null;

  for (const p of series) {

    const dir = p.direction === 'DOWN' || p.direction === 'BEARISH' ? 'DOWN' : 'UP';

    const pt = { time: p.time as UTCTimestamp, value: p.value };

    if (!cur || cur.dir !== dir) {

      if (cur && cur.points.length) segs.push(cur);

      cur = { dir, points: [pt] };

    } else {

      cur.points.push(pt);

    }

  }

  if (cur?.points.length) segs.push(cur);

  return segs.filter((s) => s.points.length >= 2);

}



function fmt(price: number, digits: number) {

  return price.toFixed(digits);

}



function fmtPct(open: number, close: number) {

  if (!open) return '0.00';

  return (((close - open) / open) * 100).toFixed(2);

}



function barsForRange(label: (typeof RANGE_PRESETS)[number], tf: Timeframe, candleCount: number): number {

  const map: Record<string, number> = {

    '1D': 24,

    '1W': 24 * 7,

    '1M': 24 * 30,

    '3M': 24 * 90,

    '6M': 24 * 180,

    '1Y': 24 * 365,

    '5Y': 24 * 365 * 5,

  };

  const tfDiv = tf === 'H1' ? 1 : tf === 'M15' ? 0.25 : tf === 'M5' ? 0.083 : tf === 'D1' ? 24 : 4;

  return Math.min(candleCount, Math.max(20, Math.floor((map[label] || 24) / tfDiv)));

}



export function InteractiveMarketChart({

  a,

  tf,

  autonomous,

  onTimeframe,

}: {

  a: AnalysisResult;

  tf: Timeframe;

  autonomous: boolean;

  onTimeframe?: (tf: Timeframe) => void;

}) {

  const hostRef = useRef<HTMLDivElement>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);

  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const lastBarRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number } | null>(

    null,

  );



  const [drawTool, setDrawTool] = useState<DrawTool>('crosshair');

  const [drawings, setDrawings] = useState<UserDrawing[]>([]);

  const [magnet, setMagnet] = useState(false);

  const [drawLocked, setDrawLocked] = useState(false);

  const [penlock, setPenlock] = useState(false);

  const [drawingsHidden, setDrawingsHidden] = useState(false);

  const [liveOhlc, setLiveOhlc] = useState<{ o: number; h: number; l: number; c: number } | null>(null);

  const [overlayFlags, setOverlayFlags] = useState<ChartOverlayFlags>(DEFAULT_CHART_OVERLAYS);

  const [indicatorsOpen, setIndicatorsOpen] = useState(false);

  const [showGrid, setShowGrid] = useState(true);

  const [priceScaleMode, setPriceScaleMode] = useState<'normal' | 'log' | 'percent'>('normal');

  const [autoScale, setAutoScale] = useState(true);

  const [activeRange, setActiveRange] = useState<(typeof RANGE_PRESETS)[number] | null>(null);

  const [chartApi, setChartApi] = useState<{

    chart: IChartApi;

    series: ISeriesApi<'Candlestick'>;

  } | null>(null);



  const quote = useAcaLiveQuote(a.symbol, true);

  const cs = useMemo(() => normalizeCandles(a.candles), [a.candles]);

  const candleTimes = useMemo(() => cs.map((c) => c.time), [cs]);

  const digits = quote?.digits ?? (a.symbol.startsWith('XAU') ? 2 : 5);



  const handleTool = useCallback((t: DrawTool) => {

    if (t === 'trash') {
      setDrawings([]);
      setDrawTool('crosshair');
      return;
    }

    if (t === 'lock') {
      setDrawLocked((v) => !v);
      if (!penlock) setDrawTool('crosshair');
      return;
    }

    if (t === 'penlock') {
      setPenlock((v) => !v);
      return;
    }

    if (t === 'magnet') {
      setMagnet((v) => !v);
      if (!penlock) setDrawTool('crosshair');
      return;
    }

    if (t === 'hide') {
      setDrawingsHidden((v) => !v);
      if (!penlock) setDrawTool('crosshair');
      return;
    }
    if (t === 'link') {
      setMagnet((v) => !v);
      if (!penlock) setDrawTool('crosshair');
      return;
    }
    if (t === 'zoom') {
      const c = chartRef.current;
      if (c) applyChartVisibleRangeWithProjection(c, cs.length, Math.min(cs.length, 120));
      if (!penlock) setDrawTool('crosshair');
      return;
    }

    setDrawTool(t);
  }, [cs.length, penlock]);



  const lwcScaleMode = useMemo(() => {

    if (priceScaleMode === 'log') return PriceScaleMode.Logarithmic;

    if (priceScaleMode === 'percent') return PriceScaleMode.Percentage;

    return PriceScaleMode.Normal;

  }, [priceScaleMode]);



  useEffect(() => {

    chartRef.current?.applyOptions({

      grid: {

        vertLines: { visible: showGrid, color: '#122033' },

        horzLines: { visible: showGrid, color: '#122033' },

      },

      rightPriceScale: {

        mode: lwcScaleMode,

        autoScale,

      },

    });

  }, [showGrid, lwcScaleMode, autoScale]);



  useEffect(() => {

    const el = hostRef.current;

    if (!el || cs.length < 2) return;



    const height = Math.max(420, el.clientHeight || 500);

    const chart = createChart(el, {

      width: el.clientWidth,

      height,

      layout: { background: { color: '#07101d' }, textColor: '#8fa3bd' },

      grid: { vertLines: { color: '#122033' }, horzLines: { color: '#122033' } },

      rightPriceScale: {
        borderColor: '#2a394a',
        mode: lwcScaleMode,
        autoScale,
        textColor: '#9db2bd',
        scaleMargins: { top: 0.08, bottom: 0.18 },
      },

      timeScale: {

        borderColor: '#24344a',

        timeVisible: true,

        secondsVisible: false,

        rightOffset: 12,

      },

      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },

      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },

      crosshair: { mode: 1 },

    });

    chartRef.current = chart;



    let vol: ISeriesApi<'Histogram'> | null = null;

    if (overlayFlags.volume) {

      vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.52, bottom: 0.02 },
        borderVisible: false,
        visible: false,
      });

    }



    const candles = chart.addSeries(CandlestickSeries, {

      upColor: '#18b981',

      downColor: '#ef5b6a',

      borderVisible: false,

      wickUpColor: '#18b981',

      wickDownColor: '#ef5b6a',

      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: '#2962ff',
      priceLineWidth: 1,
      priceLineStyle: LineStyle.LargeDashed,
    });

    candleRef.current = candles;



    const candleData = cs.map((c) => ({

      time: c.time as UTCTimestamp,

      open: c.open,

      high: c.high,

      low: c.low,

      close: c.close,

    }));

    candles.setData(candleData);

    if (vol) {

      vol.setData(

        cs.map((c) => ({

          time: c.time as UTCTimestamp,

          value: c.volume,

          color: c.close >= c.open ? 'rgba(24,185,129,0.72)' : 'rgba(239,91,106,0.72)',

        })),

      );

    }

    lastBarRef.current = candleData[candleData.length - 1] ?? null;

    setChartApi({ chart, series: candles });



    const lines = a.chartLines || [];

    if (overlayFlags.channel && lines.length >= 2) {

      const upper = chart.addSeries(LineSeries, { color: CHANNEL, lineWidth: 1, lineStyle: 2, ...silentLine });

      const lower = chart.addSeries(LineSeries, { color: CHANNEL, lineWidth: 1, lineStyle: 2, ...silentLine });

      upper.setData(ensureStrictAscTimes(lines.map((l) => ({ time: l.time as UTCTimestamp, value: l.upper }))));

      lower.setData(ensureStrictAscTimes(lines.map((l) => ({ time: l.time as UTCTimestamp, value: l.lower }))));

    }



    if (overlayFlags.supertrend) {

      const st = a.supertrendSeries || [];

      if (st.length >= 2) {

        for (const seg of stSegments(st)) {

          const color = seg.dir === 'DOWN' ? ST_DOWN : ST_UP;

          const ln = chart.addSeries(LineSeries, {

            color,

            lineWidth: 2,

            lineStyle: 0,

            lineType: LineType.WithSteps,

            ...silentLine,

          });

          ln.setData(ensureStrictAscTimes(seg.points));

        }

      }

    }



    if (overlayFlags.structureMarkers) {

      const annMarkers = a.annotations

        .map((ann) => {

          const k = ann.kind.toUpperCase();

          if (!/BOS|CHOCH|BREAK|RETEST/i.test(k)) return null;

          const c = cs[ann.timeIndex];

          if (!c) return null;

          const bear = a.direction === 'BEARISH';

          const label = k.includes('BOS') ? 'BOS' : k.includes('CHOCH') ? 'CHOCH' : ann.label.slice(0, 8);

          return {

            time: c.time as UTCTimestamp,

            position: (k.includes('BOS') ? 'aboveBar' : bear ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',

            shape: markerShape(ann.kind),

            text: label,

            color: markerColor(ann.kind, ann.tone),

          };

        })

        .filter((m): m is NonNullable<typeof m> => m !== null);



      if (annMarkers.length) createSeriesMarkers(candles, annMarkers);

    }



    applyChartVisibleRangeWithProjection(chart, cs.length, Math.min(cs.length, 120));



    const ro = new ResizeObserver(() => {

      if (!hostRef.current) return;

      chart.applyOptions({

        width: hostRef.current.clientWidth,

        height: Math.max(420, hostRef.current.clientHeight),

      });

    });

    ro.observe(el);



    return () => {

      ro.disconnect();

      chart.remove();

      chartRef.current = null;

      candleRef.current = null;

      setChartApi(null);

    };

  }, [

    a.analysisId,

    a.candles,

    a.chartLines,

    a.supertrendSeries,

    a.levels,

    a.annotations,

    a.direction,

    tf,

    cs,

    overlayFlags,

    lwcScaleMode,

    autoScale,

  ]);



  useEffect(() => {

    if (!quote || !candleRef.current || !lastBarRef.current) return;

    const bar = lastBarRef.current;

    const mid = quote.mid;

    const next = {

      ...bar,

      close: mid,

      high: Math.max(bar.high, mid),

      low: Math.min(bar.low, mid),

    };

    candleRef.current.update(next);

    setLiveOhlc({ o: bar.open, h: next.high, l: next.low, c: next.close });

  }, [quote]);



  const ohlc = liveOhlc ?? a.ohlc;

  const change = ohlc.c - ohlc.o;

  const changePct = fmtPct(ohlc.o, ohlc.c);



  const onFullscreen = async () => {

    const node = cardRef.current;

    if (!node) return;

    if (document.fullscreenElement) {

      await document.exitFullscreen();

    } else {

      await node.requestFullscreen();

    }

  };



  const onScreenshot = () => {

    const canvas = hostRef.current?.querySelector('canvas');

    if (!canvas) return;

    canvas.toBlob((blob) => {

      if (!blob) return;

      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = url;

      link.download = `${a.symbol}-${tf}-${Date.now()}.png`;

      link.click();

      URL.revokeObjectURL(url);

    });

  };



  const applyRange = (label: (typeof RANGE_PRESETS)[number]) => {

    const chart = chartRef.current;

    if (!chart || cs.length < 2) return;

    const bars = barsForRange(label, tf, cs.length);

    applyChartVisibleRangeWithProjection(chart, cs.length, bars);

    setActiveRange(label);

  };



  const footClock = useMemo(() => {

    const d = quote?.time ? new Date(quote.time) : new Date();

    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  }, [quote?.time]);



  if (cs.length < 2) {

    return (

      <div className="chartCard">

        <div className="chartBody aca-chart-empty">No closed-bar candles for this timeframe yet.</div>

      </div>

    );

  }



  return (

    <div className="chartCard chartCardInteractive" ref={cardRef}>

      <div className="chartHead">

        <div className="instrument">

          <div className="gold">◒</div>

          <div>

            <b>{a.symbol}</b>

            <small>{a.displayName}</small>

          </div>

          <select

            value={tf}

            aria-label="Timeframe"

            onChange={(e) => onTimeframe?.(e.target.value as Timeframe)}

            disabled={!onTimeframe}

          >

            {CHART_TFS.map((t) => (

              <option key={t} value={t}>

                {t}

              </option>

            ))}

          </select>

          <button type="button" className="chartTypeBtn active" title="Candlesticks">

            <CandlestickChart size={15} />

          </button>

          <button

            type="button"

            className={`chartTypeBtn ${showGrid ? 'active' : ''}`}

            title="Toggle chart grid"

            onClick={() => setShowGrid((v) => !v)}

          >

            <Grid3x3 size={15} />

          </button>

          <div className="indicatorsWrap">

            <button

              type="button"

              className={`indicatorsBtn ${indicatorsOpen ? 'active' : ''}`}

              title="Toggle analysis overlays"

              onClick={() => setIndicatorsOpen((v) => !v)}

            >
              <FlaskConical size={15} /> Indicators
            </button>

            <ChartIndicatorsMenu

              open={indicatorsOpen}

              onClose={() => setIndicatorsOpen(false)}

              flags={overlayFlags}

              onChange={setOverlayFlags}

            />

          </div>

          <div className="ohlc">

            O {fmt(ohlc.o, digits)} H {fmt(ohlc.h, digits)} L {fmt(ohlc.l, digits)}{' '}

            <b className={change >= 0 ? 'ohlcUp' : 'ohlcDown'}>

              C {fmt(ohlc.c, digits)} {change >= 0 ? '+' : ''}

              {fmt(change, digits)} ({change >= 0 ? '+' : ''}

              {changePct}%)

            </b>

            {quote && <small className="liveTick"> · live</small>}

          </div>

        </div>

        <div className="chartBtns">

          <button
            type="button"
            title="Fit visible range"
            onClick={() => {
              const c = chartRef.current;
              if (c) applyChartVisibleRangeWithProjection(c, cs.length, Math.min(cs.length, 120));
            }}
          >

            <Expand size={15} />

          </button>

          <button type="button" aria-label="Screenshot" title="Download chart PNG" onClick={onScreenshot}>

            <Camera size={15} />

          </button>

          <button type="button" aria-label="Fullscreen" title="Fullscreen chart" onClick={() => void onFullscreen()}>

            ⛶

          </button>

        </div>

      </div>

      <div className="chartBody chartBodyInteractive">
        <div className="chartTvLayout">
          <ChartDrawTools
            active={drawTool}
            onTool={handleTool}
            locked={drawLocked}
            magnet={magnet}
            penlock={penlock}
            drawingsHidden={drawingsHidden}
          />
          <div className="chartPlotArea">
            <div className="aca-lwc-host" ref={hostRef} />

        <ChartChannelFill

          chart={chartApi?.chart ?? null}

          series={chartApi?.series ?? null}

          lines={a.chartLines}

          candleTimes={candleTimes}

          candleCount={cs.length}

          visible={overlayFlags.channel && overlayFlags.channelFill}

        />

        <ChartSupertrendShade
          chart={chartApi?.chart ?? null}
          series={chartApi?.series ?? null}
          candles={cs}
          supertrend={a.supertrendSeries}
          candleCount={cs.length}
          visible={overlayFlags.supertrend}
        />

        <ChartZoneBands

          chart={chartApi?.chart ?? null}

          series={chartApi?.series ?? null}

          levels={a.levels}

          candleCount={cs.length}

          tf={tf}

          direction={a.direction}

          visible={overlayFlags.zones}

        />

        <ChartThesisOverlay
          chart={chartApi?.chart ?? null}
          series={chartApi?.series ?? null}
          a={a}
          candleCount={cs.length}
          digits={digits}
          visible={overlayFlags.thesisTags}
        />
        <ChartHorzLevelsOverlay
          chart={chartApi?.chart ?? null}
          series={chartApi?.series ?? null}
          levels={a.levels}
          showP2={overlayFlags.p2Line}
          showInvalidation={overlayFlags.thesisTags}
        />
        <ChartExpectedPathOverlay
          chart={chartApi?.chart ?? null}
          series={chartApi?.series ?? null}
          a={a}
          tf={tf}
          candleCount={cs.length}
          visible={overlayFlags.expectedPath}
        />
        <ChartDrawOverlay
          tool={drawTool}
          locked={drawLocked}
          drawings={drawings}
          onChange={setDrawings}
          hidden={drawingsHidden}
        />
          </div>
        </div>
      </div>

      <div className="chartFoot chartFootTv">

        <div className="chartRangeBtns">

          {RANGE_PRESETS.map((label) => (

            <button

              key={label}

              type="button"

              className={activeRange === label ? 'active' : ''}

              onClick={() => applyRange(label)}

            >

              {label}

            </button>

          ))}

        </div>

        <div className="chartScaleBtns">

          <button

            type="button"

            className={priceScaleMode === 'percent' ? 'active' : ''}

            onClick={() => setPriceScaleMode((m) => (m === 'percent' ? 'normal' : 'percent'))}

          >

            %

          </button>

          <button

            type="button"

            className={priceScaleMode === 'log' ? 'active' : ''}

            onClick={() => setPriceScaleMode((m) => (m === 'log' ? 'normal' : 'log'))}

          >

            log

          </button>

          <button

            type="button"

            className={autoScale ? 'active' : ''}

            onClick={() => setAutoScale((v) => !v)}

          >

            auto

          </button>

        </div>

        <div className="chartFootClock">

          {footClock} ({Intl.DateTimeFormat().resolvedOptions().timeZone}) ·{' '}

          <b>{autonomous ? 'Auto analyse' : 'Manual'}</b>

        </div>

      </div>

    </div>

  );

}


