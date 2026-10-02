import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';
import type { UserDrawing } from '../production-v4/components/ChartDrawOverlay';
import type { DrawTool } from '../production-v4/components/ChartDrawTools';
import { buildCompositorModel } from './buildCompositorModel';
import { formatPrice, normalizeAutonomousSnapshot } from './autonomousAdapter';
import { indexAtPlotX, sliceSnapshotForViewport } from './chartViewport';
import { V4_RAIL_TOOLS } from './v4ChartTools';
import {
  clientToSvg,
  finishDrawing,
  isDrawTool,
  snapPoint,
  UserDrawingLayer,
} from './v4SvgDrawing';
import {
  CHART_H,
  CHART_W,
  MARGIN_L,
  MARGIN_R,
  MARGIN_T,
  makeIndexX,
  makePriceY,
  plotHeight,
  plotWidth,
} from './compositorLayout';
import { useV4ChartInteraction } from './useV4ChartInteraction';

const RANGE_PRESETS = ['5Y', '1Y', '6M', '3M', '1M', '1W', '1D'] as const;

const SYMBOL_NAMES: Record<string, string> = {
  XAUUSD: 'Gold vs US Dollar',
  EURUSD: 'Euro vs US Dollar',
};

type Props = {
  snapshot: AutonomousSnapshot;
  timeframe: string;
  timeframeOptions?: readonly string[];
  onTimeframe?: (tf: string) => void;
  liveTick?: boolean;
};

export default function V4ChartSvg({ snapshot, timeframe, timeframeOptions, onTimeframe, liveTick }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const plotHostRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState<DrawTool>('crosshair');
  const [drawings, setDrawings] = useState<UserDrawing[]>([]);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [magnetActive, setMagnetActive] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawDraft, setDrawDraft] = useState<{ x: number; y: number } | null>(null);

  const barCount = snapshot.chart.candles.length;
  const {
    viewport,
    hoverIndex,
    showOverlays,
    setShowOverlays,
    activeRange,
    setRangePreset,
    resetView,
    zoomBy,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  } = useV4ChartInteraction(barCount);

  const viewSnapshot = useMemo(
    () => sliceSnapshotForViewport(snapshot, viewport),
    [snapshot, viewport],
  );

  const model = useMemo(
    () => buildCompositorModel(normalizeAutonomousSnapshot(viewSnapshot)),
    [viewSnapshot],
  );

  const x = useMemo(() => makeIndexX(model.n), [model.n]);
  const y = useMemo(() => makePriceY(model.pMin, model.pMax), [model.pMin, model.pMax]);
  const pw = plotWidth();
  const ph = plotHeight();
  const candles = viewSnapshot.chart.candles;
  const displayCandle =
    hoverIndex != null && candles[hoverIndex] ? candles[hoverIndex]! : candles[candles.length - 1]!;
  const displayPrev =
    hoverIndex != null && hoverIndex > 0
      ? candles[hoverIndex - 1]
      : candles[candles.length - 2];
  const open = displayPrev?.close ?? displayCandle.open;
  const chg = displayCandle.close - open;
  const chgPct = open ? (chg / open) * 100 : 0;
  const clipId = `aca-v4-clip-${snapshot.analysisId.replace(/[^a-z0-9]/gi, '')}`;

  const hoverX = hoverIndex != null ? x(hoverIndex) : null;
  const hoverY = hoverIndex != null ? y(displayCandle.close) : null;

  const toggleFullscreen = () => {
    const el = cardRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (activeTool !== 'crosshair') return;
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      zoomBy(e.deltaY > 0 ? 1.12 : 0.88, ratio);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [activeTool, zoomBy]);

  const snap = useCallback(
    (pt: { x: number; y: number }) =>
      snapPoint({
        x: pt.x,
        y: pt.y,
        magnet: magnetActive,
        candles: viewSnapshot.chart.candles,
        indexAt: (px) => indexAtPlotX(px, model.n, MARGIN_L, pw),
        priceAt: (p) => y(p),
        xAt: (i) => x(i),
      }),
    [magnetActive, model.n, pw, viewSnapshot.chart.candles, x, y],
  );

  const selectRailTool = (tool: DrawTool) => {
    if (tool === 'trash') {
      setDrawings([]);
      setActiveTool('crosshair');
      return;
    }
    if (tool === 'zoom') {
      resetView();
      return;
    }
    if (tool === 'hide') {
      setDrawingsHidden((v) => !v);
      return;
    }
    if (tool === 'magnet') {
      setMagnetActive((v) => !v);
      return;
    }
    setActiveTool(tool);
  };

  const plotCursor =
    activeTool === 'crosshair' ? 'crosshair' : isDrawTool(activeTool) ? 'crosshair' : 'default';

  const onPlotPointerDown = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    if (isDrawTool(activeTool) && svg) {
      const raw = clientToSvg(svg, e.clientX, e.clientY);
      if (!raw) return;
      const pt = snap(raw);
      if (activeTool === 'text') {
        const text = window.prompt('Label text', 'Note')?.trim();
        if (text) setDrawings((d) => [...d, { id: `t-${Date.now()}`, kind: 'text', x: pt.x, y: pt.y, text }]);
        return;
      }
      (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
      setDrawStart(pt);
      setDrawDraft(pt);
      return;
    }
    onPointerDown(e, activeTool === 'crosshair');
  };

  const onPlotPointerMove = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    if (drawStart && svg) {
      const raw = clientToSvg(svg, e.clientX, e.clientY);
      if (raw) setDrawDraft(snap(raw));
      return;
    }
    if (activeTool === 'crosshair') onPointerMove(e, svg);
  };

  const onPlotPointerUp = (e: ReactPointerEvent) => {
    if (drawStart && drawDraft && isDrawTool(activeTool)) {
      setDrawings((d) => finishDrawing(activeTool, d, drawStart, drawDraft));
      setDrawStart(null);
      setDrawDraft(null);
    } else {
      onPointerUp(e);
    }
    try {
      (e.currentTarget as SVGRectElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="chartCard chartCardInteractive" ref={cardRef}>
      <div className="chartHeader">
        <div className="assetIcon">⌁</div>
        <div className="asset">
          <b>{snapshot.symbol}</b>
          <span>{SYMBOL_NAMES[snapshot.symbol] ?? snapshot.symbol}</span>
        </div>
        {timeframeOptions && onTimeframe ? (
          <select className="tfBtn" value={timeframe} onChange={(e) => onTimeframe(e.target.value)}>
            {timeframeOptions.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className="tfBtn">
            {timeframe}⌄
          </button>
        )}
        <div className="ohlc">
          O <b>{formatPrice(snapshot.symbol, displayCandle.open)}</b>&nbsp;&nbsp; H{' '}
          <b>{formatPrice(snapshot.symbol, displayCandle.high)}</b>&nbsp;&nbsp; L{' '}
          <b>{formatPrice(snapshot.symbol, displayCandle.low)}</b>&nbsp;&nbsp; C{' '}
          <strong>{formatPrice(snapshot.symbol, displayCandle.close)}</strong>&nbsp;{' '}
          <strong className={chg >= 0 ? 'up' : 'down'}>
            {chg >= 0 ? '+' : ''}
            {formatPrice(snapshot.symbol, chg)} ({chg >= 0 ? '+' : ''}
            {chgPct.toFixed(2)}%)
          </strong>
          {hoverIndex != null ? <em className="ohlc-hint"> · bar {viewport.from + hoverIndex + 1}</em> : null}
          {liveTick && hoverIndex == null ? <small className="liveTick"> · live</small> : null}
        </div>
        <div className="chartBtns">
          <button type="button" title="Reset view" onClick={resetView}>
            ♮
          </button>
          <button type="button" title="Toggle grid" className={showOverlays ? 'active' : ''}>
            ▦
          </button>
          <button
            type="button"
            className={showOverlays ? 'active' : ''}
            onClick={() => setShowOverlays((v) => !v)}
          >
            ⌁ Indicators
          </button>
          <button
            type="button"
            title="Crosshair"
            className={activeTool === 'crosshair' ? 'active' : ''}
            onClick={() => setActiveTool('crosshair')}
          >
            ▣
          </button>
          <button type="button" title="Fullscreen" onClick={toggleFullscreen}>
            ⛶
          </button>
        </div>
      </div>
      <div className="chartArea">
        <div className="toolrail">
          {V4_RAIL_TOOLS.map((t) => (
            <button
              type="button"
              key={t.icon}
              className={
                (t.tool === 'crosshair' && activeTool === 'crosshair') ||
                (t.tool === 'magnet' && magnetActive) ||
                (t.tool !== 'crosshair' && t.tool !== 'magnet' && activeTool === t.tool)
                  ? 'active'
                  : undefined
              }
              title={t.label}
              onClick={() => selectRailTool(t.tool)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div className="chartPlotHost" ref={plotHostRef}>
          <svg
            ref={svgRef}
            className="chartPlotSvg"
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            aria-label="AI chart analysis"
          >
            <defs>
              <linearGradient id="sup" x1="0" y1="0" x2="0" y2="1">
                <stop stopColor="#c32f70" stopOpacity=".42" />
                <stop offset="1" stopColor="#5d173d" stopOpacity=".22" />
              </linearGradient>
              <linearGradient id="dem">
                <stop stopColor="#0c845e" stopOpacity=".34" />
                <stop offset="1" stopColor="#053f35" stopOpacity=".24" />
              </linearGradient>
              <clipPath id={clipId}>
                <rect x={MARGIN_L} y={MARGIN_T} width={pw} height={ph} />
              </clipPath>
              <filter id="acaScenarioGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect x={MARGIN_L} y={MARGIN_T} width={pw} height={ph} fill="#041824" />
            {model.gridPrices.map((p, i) => {
              const yy = y(p);
              return (
                <g key={`g-${i}`}>
                  <line x1={MARGIN_L} x2={MARGIN_L + pw} y1={yy} y2={yy} stroke="#17394c" strokeWidth={1} />
                  <text x={MARGIN_L + pw + 9} y={yy + 4} fill="#b7cad7" fontSize={10}>
                    {model.priceLabels[i]}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: 11 }, (_, i) => {
              const xx = MARGIN_L + (pw * i) / 10;
              return (
                <line key={`v-${i}`} x1={xx} x2={xx} y1={MARGIN_T} y2={MARGIN_T + ph} stroke="#15384b" strokeWidth={1} />
              );
            })}
            <g clipPath={`url(#${clipId})`}>
              {showOverlays
                ? model.zones.map((z) => (
                    <g key={z.label}>
                      <rect
                        x={z.x}
                        y={z.y}
                        width={z.w}
                        height={z.h}
                        fill={z.kind === 'sup' ? 'url(#sup)' : 'url(#dem)'}
                        stroke={z.kind === 'sup' ? '#d33c79' : '#00a96e'}
                        strokeWidth={1.2}
                      />
                      <text
                        x={z.x + z.w - 8}
                        y={z.y + z.h / 2 + 4}
                        textAnchor="end"
                        fill="#fff"
                        fontSize={11}
                        fontWeight={700}
                      >
                        {z.label}
                      </text>
                    </g>
                  ))
                : null}
              {model.candles.map((c, i) => {
                const xx = x(i);
                return (
                  <rect
                    key={`vol-${i}`}
                    x={xx - 2}
                    y={MARGIN_T + ph - c.vh}
                    width={4}
                    height={c.vh}
                    fill={c.c >= c.o ? '#087f79' : '#873642'}
                    opacity={0.72}
                  />
                );
              })}
              {showOverlays
                ? model.channelLines.map((ln, i) => (
                    <line
                      key={`ch-${i}`}
                      x1={ln.x1}
                      y1={ln.y1}
                      x2={ln.x2}
                      y2={ln.y2}
                      stroke={ln.stroke}
                      strokeWidth={ln.width}
                      strokeDasharray={ln.dash}
                    />
                  ))
                : null}
              {showOverlays
                ? model.stPaths.map((p, i) => (
                    <path key={`st-${i}`} d={p.d} fill="none" stroke={p.color} strokeWidth={2} />
                  ))
                : null}
              {model.candles.map((c, i) => {
                const xx = x(i);
                const up = c.c >= c.o;
                const col = up ? '#00d6c1' : '#ff3b52';
                const bodyTop = Math.min(y(c.o), y(c.c));
                const bodyH = Math.max(1.5, Math.abs(y(c.o) - y(c.c)));
                const hot = hoverIndex === i;
                return (
                  <g key={`c-${i}`} className={hot ? 'candle-hot' : undefined}>
                    <line x1={xx} x2={xx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={hot ? 1.6 : 1} />
                    <rect x={xx - 3} y={bodyTop} width={6} height={bodyH} fill={col} rx={0.7} />
                    {hot ? (
                      <rect
                        x={xx - 6}
                        y={Math.min(y(c.h), bodyTop) - 4}
                        width={12}
                        height={Math.max(8, Math.abs(y(c.l) - y(c.h)) + bodyH + 8)}
                        fill="none"
                        stroke="#0fe4ed"
                        strokeWidth={1.2}
                        rx={2}
                      />
                    ) : null}
                  </g>
                );
              })}
              {showOverlays && model.scenarioPath ? (
                <g className="aca-scenario" aria-label="AI expected path">
                  <path
                    d={model.scenarioPath}
                    fill="none"
                    stroke="#0fe4ed"
                    strokeWidth={2.3}
                    strokeDasharray="7 6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#acaScenarioGlow)"
                  />
                  {model.scenarioArrows.map((d, i) => (
                    <path key={`sa-${i}`} d={d} fill="#0fe4ed" filter="url(#acaScenarioGlow)" />
                  ))}
                </g>
              ) : null}
              {showOverlays
                ? model.markers.map((m, i) =>
                    m.kind === 'swing' ? (
                      <g key={`m-${i}`}>
                        <circle cx={m.x} cy={m.y} r={12} fill={m.fill} stroke="#03121c" strokeWidth={2} />
                        <text x={m.x} y={m.y + 4} textAnchor="middle" fill="#06141d" fontSize={10} fontWeight={900}>
                          {m.num}
                        </text>
                      </g>
                    ) : (
                      <text key={`m-${i}`} x={m.x} y={m.y} fill={m.color} fontSize={11} fontWeight={800}>
                        {m.text}
                      </text>
                    ),
                  )
                : null}
            </g>
            {activeTool === 'crosshair' && hoverX != null && hoverY != null ? (
              <g className="crosshair-layer" pointerEvents="none">
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={MARGIN_T}
                  y2={MARGIN_T + ph}
                  stroke="#4ccfff"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.85}
                />
                <line
                  x1={MARGIN_L}
                  x2={MARGIN_L + pw}
                  y1={hoverY}
                  y2={hoverY}
                  stroke="#4ccfff"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.85}
                />
              </g>
            ) : null}
            <line
              x1={MARGIN_L}
              x2={MARGIN_L + pw}
              y1={model.priceLine.y}
              y2={model.priceLine.y}
              stroke="#0b83e9"
              strokeWidth={1}
            />
            <rect x={MARGIN_L + pw} y={model.priceLine.y - 12} width={MARGIN_R} height={24} fill="#0b7fe9" />
            <text
              x={MARGIN_L + pw + MARGIN_R / 2}
              y={model.priceLine.y + 4}
              textAnchor="middle"
              fill="#fff"
              fontSize={10}
              fontWeight={700}
            >
              {model.priceLine.label}
            </text>
            {showOverlays
              ? model.levels.map((lv, i) => {
                  const col = lv.tone === 'red' ? '#ff284f' : '#00e48f';
                  const bx = MARGIN_L + pw - 95;
                  return (
                    <g key={`lv-${i}`}>
                      <line
                        x1={lv.xStart}
                        y1={lv.y}
                        x2={MARGIN_L + pw - 4}
                        y2={lv.y}
                        stroke={col}
                        strokeWidth={lv.tone === 'red' ? 2 : 1.3}
                        strokeDasharray={lv.tone === 'red' ? undefined : '6 4'}
                      />
                      <rect
                        x={bx}
                        y={lv.y - 15}
                        width={90}
                        height={30}
                        rx={3}
                        fill="#061e24"
                        stroke={col}
                        strokeWidth={1.4}
                      />
                      <text x={bx + 45} y={lv.y - 1} textAnchor="middle" fill={col} fontSize={10} fontWeight={800}>
                        {lv.line1}
                      </text>
                      {lv.line2 ? (
                        <text x={bx + 45} y={lv.y + 11} textAnchor="middle" fill={col} fontSize={10} fontWeight={800}>
                          {lv.line2}
                        </text>
                      ) : null}
                    </g>
                  );
                })
              : null}
            {showOverlays && model.p2 ? (
              <g>
                <line
                  x1={model.p2.xStart}
                  y1={model.p2.y}
                  x2={MARGIN_L + pw - 6}
                  y2={model.p2.y}
                  stroke="#9ab0bf"
                  strokeWidth={1}
                />
                <rect x={MARGIN_L + pw - 90} y={model.p2.y - 13} width={84} height={26} fill="#253746" rx={2} />
                <text
                  x={MARGIN_L + pw - 48}
                  y={model.p2.y + 4}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={10}
                  fontWeight={700}
                >
                  P2 Break
                </text>
              </g>
            ) : null}
            {model.timeLabels.map((v, i) => (
              <text key={`t-${i}`} x={MARGIN_L + (pw * i) / 11} y={MARGIN_T + ph + 25} fill="#a8bdcc" fontSize={10}>
                {v}
              </text>
            ))}
            {!drawingsHidden ? (
              <g clipPath={`url(#${clipId})`}>
                <UserDrawingLayer drawings={drawings} />
              </g>
            ) : null}
            {drawStart && drawDraft && isDrawTool(activeTool) && activeTool !== 'text' ? (
              <line
                x1={drawStart.x}
                y1={drawStart.y}
                x2={drawDraft.x}
                y2={activeTool === 'hline' ? drawStart.y : activeTool === 'vline' ? drawDraft.y : drawDraft.y}
                stroke="#51d9ff"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            ) : null}
            <rect
              className="plot-hit"
              x={MARGIN_L}
              y={MARGIN_T}
              width={pw}
              height={ph}
              fill="transparent"
              style={{ cursor: plotCursor }}
              onPointerDown={onPlotPointerDown}
              onPointerMove={onPlotPointerMove}
              onPointerUp={onPlotPointerUp}
              onPointerLeave={() => {
                if (!drawStart) onPointerLeave();
              }}
              onDoubleClick={resetView}
            />
          </svg>
        </div>
      </div>
      <div className="chartFooter">
        <div className="rangeBtns">
          {RANGE_PRESETS.map((r) => (
            <button
              key={r}
              type="button"
              className={activeRange === r ? 'active' : undefined}
              onClick={() => setRangePreset(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div>
          {new Date().toLocaleTimeString()} (local)&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;%&nbsp;&nbsp;&nbsp; log&nbsp;&nbsp;&nbsp;{' '}
          <b>auto</b>
          <span className="chart-hint"> · drag pan · wheel zoom · double-click reset</span>
        </div>
      </div>
    </div>
  );
}
