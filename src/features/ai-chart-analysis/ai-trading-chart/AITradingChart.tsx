import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './AITradingChart.css';

export type Direction = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  closed?: boolean;
}

export interface SupertrendPoint {
  time: number;
  value: number;
  direction: 'BULLISH' | 'BEARISH';
}

export interface ChannelPoint {
  time: number;
  price: number;
}

export interface ChannelModel {
  id: string;
  direction: Direction;
  upperStart: ChannelPoint;
  upperEnd: ChannelPoint;
  lowerStart: ChannelPoint;
  lowerEnd: ChannelPoint;
  medianStart?: ChannelPoint;
  medianEnd?: ChannelPoint;
}

export interface ZoneModel {
  id: string;
  type: 'SUPPLY' | 'DEMAND' | 'ERZ';
  label: string;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  state?: 'ACTIVE' | 'TOUCHED' | 'REACTION' | 'INVALIDATED' | 'HISTORICAL';
}

export interface StructureAnnotation {
  id: string;
  type:
    | 'BOS'
    | 'CHOCH'
    | 'SWING_HIGH'
    | 'SWING_LOW'
    | 'P1'
    | 'P2_BREAK'
    | 'REACTION'
    | 'RETEST';
  time: number;
  price: number;
  label: string;
  direction?: Direction;
  sequence?: number;
  priority?: number;
  state?: 'OBSERVED' | 'DETECTED' | 'INTERPRETED' | 'CONFIRMED' | 'INVALIDATED';
}

export interface HorizontalLevel {
  id: string;
  type: 'TARGET' | 'INVALIDATION' | 'ENTRY' | 'BREAK';
  price: number;
  label: string;
  direction?: Direction;
}

export interface ProjectedScenarioPoint {
  id: string;
  time: number;
  price: number;
  label?: 'CURRENT' | 'ERZ' | 'REACTION' | 'BOS' | 'RETEST' | 'T1' | 'T2';
}

export interface ChartModel {
  symbol: string;
  instrumentName?: string;
  timeframe: string;
  candles: Candle[];
  supertrend?: SupertrendPoint[];
  channels?: ChannelModel[];
  zones?: ZoneModel[];
  structures?: StructureAnnotation[];
  levels?: HorizontalLevel[];
  projectedScenario?: ProjectedScenarioPoint[];
  currentPrice?: number;
  timezoneLabel?: string;
}

interface ChartDimensions {
  width: number;
  height: number;
  toolbarWidth: number;
  priceAxisWidth: number;
  top: number;
  bottomAxisHeight: number;
  volumeHeight: number;
}

interface PriceScale {
  min: number;
  max: number;
  range: number;
}

interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function validCandle(candle: Candle): boolean {
  return (
    finite(candle.time) !== null &&
    finite(candle.open) !== null &&
    finite(candle.high) !== null &&
    finite(candle.low) !== null &&
    finite(candle.close) !== null
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatPrice(price: number) {
  if (!Number.isFinite(price)) return '—';
  const digits = price > 100 ? 2 : price > 10 ? 3 : 5;
  return price.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const ToolIcon = ({
  children,
  active = false,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  title?: string;
}) => (
  <button className={`chart-tool ${active ? 'active' : ''}`} title={title} type="button">
    {children}
  </button>
);

export type AITradingChartProps = {
  model: ChartModel;
  onTimeframe?: (tf: string) => void;
  timeframeOptions?: readonly string[];
};

export default function AITradingChart({ model, onTimeframe, timeframeOptions }: AITradingChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 680 });
  const [showVolume, setShowVolume] = useState(true);
  const [showSupertrend, setShowSupertrend] = useState(true);
  const [showChannels, setShowChannels] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showScenario, setShowScenario] = useState(true);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: Math.max(700, entry.contentRect.width),
        height: Math.max(500, entry.contentRect.height),
      });
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const candles = useMemo(() => {
    return model.candles
      .filter(validCandle)
      .map((candle) => ({
        ...candle,
        time: Number(candle.time),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number.isFinite(Number(candle.volume)) ? Number(candle.volume) : 0,
      }))
      .sort((a, b) => a.time - b.time);
  }, [model.candles]);

  const dimensions: ChartDimensions = useMemo(
    () => ({
      width: size.width,
      height: size.height,
      toolbarWidth: 72,
      priceAxisWidth: 86,
      top: 14,
      bottomAxisHeight: 48,
      volumeHeight: showVolume ? 120 : 0,
    }),
    [size, showVolume],
  );

  const plotLeft = dimensions.toolbarWidth;
  const plotRight = dimensions.width - dimensions.priceAxisWidth;
  const plotTop = dimensions.top;
  const plotBottom = dimensions.height - dimensions.bottomAxisHeight - dimensions.volumeHeight;
  const volumeBottom = dimensions.height - dimensions.bottomAxisHeight;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const timeScale = useMemo(() => {
    if (!candles.length) return { min: 0, max: 1, range: 1 };
    const minimum = candles[0]!.time;
    const maximum = candles[candles.length - 1]!.time;
    const rawRange = Math.max(1, maximum - minimum);
    const extension = rawRange * 0.22;
    return { min: minimum, max: maximum + extension, range: rawRange + extension };
  }, [candles]);

  const priceScale: PriceScale = useMemo(() => {
    const values: number[] = [];
    candles.forEach((candle) => values.push(candle.high, candle.low));
    model.zones?.forEach((zone) => {
      const high = finite(zone.high);
      const low = finite(zone.low);
      if (high !== null) values.push(high);
      if (low !== null) values.push(low);
    });
    model.levels?.forEach((level) => {
      const price = finite(level.price);
      if (price !== null) values.push(price);
    });
    model.projectedScenario?.forEach((point) => {
      const price = finite(point.price);
      if (price !== null) values.push(price);
    });
    model.channels?.forEach((channel) => {
      [
        channel.upperStart.price,
        channel.upperEnd.price,
        channel.lowerStart.price,
        channel.lowerEnd.price,
        channel.medianStart?.price,
        channel.medianEnd?.price,
      ].forEach((value) => {
        const price = finite(value);
        if (price !== null) values.push(price);
      });
    });
    if (!values.length) return { min: 0, max: 1, range: 1 };
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    let range = maximum - minimum;
    if (!Number.isFinite(range) || range <= 0) range = Math.max(Math.abs(maximum) * 0.01, 1);
    const padding = range * 0.08;
    return { min: minimum - padding, max: maximum + padding, range: range + padding * 2 };
  }, [candles, model.channels, model.levels, model.projectedScenario, model.zones]);

  const timeToX = useCallback(
    (time: number) => {
      if (!Number.isFinite(time)) return null;
      const normalized = (time - timeScale.min) / timeScale.range;
      const x = plotLeft + normalized * plotWidth;
      return Number.isFinite(x) ? x : null;
    },
    [plotLeft, plotWidth, timeScale],
  );

  const priceToY = useCallback(
    (price: number) => {
      if (!Number.isFinite(price) || !Number.isFinite(priceScale.range) || priceScale.range <= 0) return null;
      const normalized = (priceScale.max - price) / priceScale.range;
      const y = plotTop + normalized * plotHeight;
      return Number.isFinite(y) ? y : null;
    },
    [plotHeight, plotTop, priceScale],
  );

  const latest = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : undefined;
  const change = latest && previous ? latest.close - previous.close : 0;
  const changePercent = previous && previous.close !== 0 ? (change / previous.close) * 100 : 0;

  const candleWidth = useMemo(() => {
    if (candles.length <= 1) return 7;
    const x1 = timeToX(candles[0]!.time);
    const x2 = timeToX(candles[1]!.time);
    if (x1 === null || x2 === null) return 7;
    return clamp(Math.abs(x2 - x1) * 0.62, 3, 12);
  }, [candles, timeToX]);

  const priceTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 8;
    for (let index = 0; index <= count; index++) {
      ticks.push(priceScale.min + (priceScale.range / count) * index);
    }
    return ticks;
  }, [priceScale]);

  const timeTicks = useMemo(() => {
    if (!candles.length) return [];
    const count = Math.min(10, candles.length);
    const ticks: Candle[] = [];
    for (let index = 0; index < count; index++) {
      const candleIndex = Math.round((index / Math.max(1, count - 1)) * (candles.length - 1));
      const candle = candles[candleIndex];
      if (candle && !ticks.some((item) => item.time === candle.time)) ticks.push(candle);
    }
    return ticks;
  }, [candles]);

  const maximumVolume = useMemo(() => {
    return Math.max(
      1,
      ...candles.map((candle) => (Number.isFinite(candle.volume) ? candle.volume || 0 : 0)),
    );
  }, [candles]);

  const supertrendSegments = useMemo(() => {
    const valid =
      model.supertrend
        ?.filter((point) => finite(point.time) !== null && finite(point.value) !== null)
        .sort((a, b) => a.time - b.time) || [];
    if (!valid.length) return [];
    const groups: SupertrendPoint[][] = [];
    let current: SupertrendPoint[] = [];
    valid.forEach((point) => {
      if (current.length && current[current.length - 1]!.direction !== point.direction) {
        groups.push(current);
        current = [];
      }
      current.push(point);
    });
    if (current.length) groups.push(current);
    return groups;
  }, [model.supertrend]);

  const structureLabels = useMemo(() => {
    const structures = [...(model.structures || [])]
      .filter((item) => finite(item.time) !== null && finite(item.price) !== null)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const occupied: LabelBox[] = [];
    return structures
      .map((item) => {
        const x = timeToX(item.time);
        const y = priceToY(item.price);
        if (x === null || y === null) return null;
        const width =
          item.type === 'SWING_HIGH' || item.type === 'SWING_LOW' ? 34 : Math.max(48, item.label.length * 8);
        const height = 24;
        let labelY = item.type === 'SWING_LOW' ? y + 18 : y - 36;
        const priority = item.priority || 50;
        for (let attempt = 0; attempt < 8; attempt++) {
          const candidate: LabelBox = {
            id: item.id,
            x: x - width / 2,
            y: labelY,
            width,
            height,
            priority,
          };
          const collides = occupied.some((existing) => {
            const horizontal = candidate.x < existing.x + existing.width + 6 && candidate.x + candidate.width + 6 > existing.x;
            const vertical =
              candidate.y < existing.y + existing.height + 4 && candidate.y + candidate.height + 4 > existing.y;
            return horizontal && vertical;
          });
          if (!collides) {
            occupied.push(candidate);
            return { item, x, y, labelY };
          }
          labelY += item.type === 'SWING_LOW' ? 28 : -28;
        }
        return null;
      })
      .filter(Boolean) as Array<{ item: StructureAnnotation; x: number; y: number; labelY: number }>;
  }, [model.structures, priceToY, timeToX]);

  const tfOptions = timeframeOptions?.length ? timeframeOptions : [model.timeframe];

  if (!candles.length) {
    return (
      <div className="ai-chart-empty">
        <strong>No valid chart data</strong>
        <span>Waiting for valid OHLC candles from the market bridge.</span>
      </div>
    );
  }

  return (
    <div className="ai-trading-chart" ref={wrapperRef}>
      <div className="chart-header">
        <div className="instrument-block">
          <div className="instrument-icon">◆</div>
          <div>
            <div className="instrument-symbol">{model.symbol}</div>
            <div className="instrument-name">{model.instrumentName || model.symbol}</div>
          </div>
        </div>
        {onTimeframe && tfOptions.length > 1 ? (
          <select
            className="timeframe-selector timeframe-select-native"
            value={model.timeframe}
            onChange={(e) => onTimeframe(e.target.value)}
            aria-label="Timeframe"
          >
            {tfOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : (
          <button className="timeframe-selector" type="button">
            {model.timeframe}
            <span>⌄</span>
          </button>
        )}
        <div className="ohlc-strip">
          <span>
            O <strong>{formatPrice(latest!.open)}</strong>
          </span>
          <span>
            H <strong>{formatPrice(latest!.high)}</strong>
          </span>
          <span>
            L <strong>{formatPrice(latest!.low)}</strong>
          </span>
          <span>
            C{' '}
            <strong className={latest!.close >= latest!.open ? 'positive' : 'negative'}>
              {formatPrice(latest!.close)}
            </strong>
          </span>
          <span className={change >= 0 ? 'positive' : 'negative'}>
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)} ({changePercent >= 0 ? '+' : ''}
            {changePercent.toFixed(2)}%)
          </span>
        </div>
        <div className="header-actions">
          <button className={showSupertrend ? 'active' : ''} type="button" onClick={() => setShowSupertrend((v) => !v)}>
            ◫
          </button>
          <button className={showVolume ? 'active' : ''} type="button" onClick={() => setShowVolume((v) => !v)}>
            ▦
          </button>
          <button className="indicator-button" type="button">
            ⌁
            <span>Indicators</span>
          </button>
          <button type="button">▣</button>
          <button type="button">⛶</button>
        </div>
      </div>

      <div className="chart-body">
        <div className="drawing-toolbar">
          <ToolIcon active title="Crosshair">
            ＋
          </ToolIcon>
          <ToolIcon title="Trend line">╱</ToolIcon>
          <ToolIcon title="Channel">⌁</ToolIcon>
          <ToolIcon title="Structure">⌘</ToolIcon>
          <ToolIcon title="Measure">⌗</ToolIcon>
          <ToolIcon title="Text">T</ToolIcon>
          <ToolIcon title="Rectangle">□</ToolIcon>
          <ToolIcon title="Draw">✎</ToolIcon>
          <ToolIcon title="Zoom">⊕</ToolIcon>
          <ToolIcon title="Magnet">∩</ToolIcon>
          <ToolIcon title="Link">⌕</ToolIcon>
          <ToolIcon title="Lock">♙</ToolIcon>
        </div>

        <svg
          className="chart-svg"
          width={dimensions.width}
          height={dimensions.height}
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="supplyFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#d12d75" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#d12d75" stopOpacity="0.10" />
            </linearGradient>
            <linearGradient id="demandFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0dd487" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#0dd487" stopOpacity="0.24" />
            </linearGradient>
            <filter id="cyanGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect x={plotLeft} y={0} width={plotRight - plotLeft} height={dimensions.height} fill="#061522" />

          {priceTicks.map((price) => {
            const y = priceToY(price);
            if (y === null) return null;
            return (
              <g key={`price-grid-${price}`}>
                <line x1={plotLeft} y1={y} x2={plotRight} y2={y} className="grid-line" />
                <text x={plotRight + 14} y={y + 5} className="price-axis-label">
                  {formatPrice(price)}
                </text>
              </g>
            );
          })}

          {timeTicks.map((candle) => {
            const x = timeToX(candle.time);
            if (x === null) return null;
            const date = new Date(candle.time);
            return (
              <g key={`time-grid-${candle.time}`}>
                <line x1={x} y1={plotTop} x2={x} y2={volumeBottom} className="grid-line" />
                <text x={x} y={dimensions.height - 17} textAnchor="middle" className="time-axis-label">
                  {date.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: date.getDate() === 1 ? 'short' : undefined,
                  })}
                </text>
              </g>
            );
          })}

          {showChannels &&
            model.channels?.map((channel) => {
              const ux1 = timeToX(channel.upperStart.time);
              const uy1 = priceToY(channel.upperStart.price);
              const ux2 = timeToX(channel.upperEnd.time);
              const uy2 = priceToY(channel.upperEnd.price);
              const lx1 = timeToX(channel.lowerStart.time);
              const ly1 = priceToY(channel.lowerStart.price);
              const lx2 = timeToX(channel.lowerEnd.time);
              const ly2 = priceToY(channel.lowerEnd.price);
              if ([ux1, uy1, ux2, uy2, lx1, ly1, lx2, ly2].some((v) => v === null)) return null;
              return (
                <g key={`channel-${channel.id}`}>
                  <line x1={ux1!} y1={uy1!} x2={ux2!} y2={uy2!} className="channel-line" />
                  <line x1={lx1!} y1={ly1!} x2={lx2!} y2={ly2!} className="channel-line" />
                  {channel.medianStart &&
                    channel.medianEnd &&
                    (() => {
                      const mx1 = timeToX(channel.medianStart!.time);
                      const my1 = priceToY(channel.medianStart!.price);
                      const mx2 = timeToX(channel.medianEnd!.time);
                      const my2 = priceToY(channel.medianEnd!.price);
                      if ([mx1, my1, mx2, my2].some((v) => v === null)) return null;
                      return <line x1={mx1!} y1={my1!} x2={mx2!} y2={my2!} className="channel-median" />;
                    })()}
                </g>
              );
            })}

          {showZones &&
            model.zones?.map((zone) => {
              const x1 = timeToX(zone.startTime);
              const x2 = timeToX(zone.endTime);
              const y1 = priceToY(zone.high);
              const y2 = priceToY(zone.low);
              if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
              const width = Math.max(1, x2 - x1);
              const height = Math.max(1, y2 - y1);
              const supply = zone.type === 'SUPPLY';
              return (
                <g key={`zone-${zone.id}`}>
                  <rect
                    x={x1}
                    y={y1}
                    width={width}
                    height={height}
                    className={supply ? 'supply-zone' : 'demand-zone'}
                  />
                  <text x={x2 - 16} y={y1 + height / 2 + 5} textAnchor="end" className="zone-label">
                    {zone.label}
                  </text>
                </g>
              );
            })}

          {showVolume &&
            candles.map((candle) => {
              const x = timeToX(candle.time);
              if (x === null) return null;
              const volume = Number.isFinite(candle.volume) ? candle.volume || 0 : 0;
              const height = (volume / maximumVolume) * Math.max(1, dimensions.volumeHeight - 18);
              const bullish = candle.close >= candle.open;
              return (
                <rect
                  key={`volume-${candle.time}`}
                  x={x - candleWidth / 2}
                  y={volumeBottom - height}
                  width={candleWidth}
                  height={height}
                  className={bullish ? 'volume-up' : 'volume-down'}
                />
              );
            })}

          {candles.map((candle) => {
            const x = timeToX(candle.time);
            const highY = priceToY(candle.high);
            const lowY = priceToY(candle.low);
            const openY = priceToY(candle.open);
            const closeY = priceToY(candle.close);
            if (x === null || highY === null || lowY === null || openY === null || closeY === null) return null;
            const bullish = candle.close >= candle.open;
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
            return (
              <g key={`candle-${candle.time}`}>
                <line x1={x} y1={highY} x2={x} y2={lowY} className={bullish ? 'wick-up' : 'wick-down'} />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  rx={0.7}
                  className={bullish ? 'candle-up' : 'candle-down'}
                />
              </g>
            );
          })}

          {showSupertrend &&
            supertrendSegments.map((segment, segmentIndex) => {
              const points = segment
                .map((point) => {
                  const x = timeToX(point.time);
                  const y = priceToY(point.value);
                  if (x === null || y === null) return null;
                  return `${x},${y}`;
                })
                .filter(Boolean)
                .join(' ');
              if (!points) return null;
              const direction = segment[0]!.direction;
              return (
                <polyline
                  key={`supertrend-${segmentIndex}-${direction}`}
                  points={points}
                  fill="none"
                  className={direction === 'BULLISH' ? 'supertrend-bull' : 'supertrend-bear'}
                />
              );
            })}

          {structureLabels.map(({ item, x, y, labelY }) => {
            if (item.type === 'SWING_HIGH' || item.type === 'SWING_LOW') {
              return (
                <g key={`structure-${item.id}`}>
                  <circle
                    cx={x}
                    cy={labelY + 10}
                    r={16}
                    className={item.type === 'SWING_HIGH' ? 'swing-high-marker' : 'swing-low-marker'}
                  />
                  <text x={x} y={labelY + 16} textAnchor="middle" className="swing-number">
                    {item.sequence || ''}
                  </text>
                </g>
              );
            }
            const bullish = item.direction === 'BULLISH';
            const className =
              item.type === 'CHOCH' ? 'structure-choch' : bullish ? 'structure-bull' : 'structure-bear';
            return (
              <g key={`structure-${item.id}`}>
                <line x1={x - 34} y1={y} x2={x + 34} y2={y} className={className} />
                <text x={x} y={labelY + 17} textAnchor="middle" className={`${className}-text`}>
                  {item.label}
                </text>
              </g>
            );
          })}

          {model.levels?.map((level) => {
            const y = priceToY(level.price);
            if (y === null) return null;
            const isTarget = level.type === 'TARGET';
            const isInvalidation = level.type === 'INVALIDATION';
            const lineStart = plotLeft + plotWidth * 0.32;
            const labelX = plotRight - 150;
            return (
              <g key={`level-${level.id}`}>
                <line
                  x1={lineStart}
                  y1={y}
                  x2={labelX}
                  y2={y}
                  className={isInvalidation ? 'invalidation-line' : isTarget ? 'target-line' : 'break-line'}
                />
                <rect
                  x={labelX}
                  y={y - 18}
                  width={136}
                  height={36}
                  rx={4}
                  className={
                    isInvalidation ? 'invalidation-label-box' : isTarget ? 'target-label-box' : 'break-label-box'
                  }
                />
                <text
                  x={labelX + 68}
                  y={y - 2}
                  textAnchor="middle"
                  className={isInvalidation ? 'invalidation-label' : isTarget ? 'target-label' : 'break-label'}
                >
                  {level.label}
                </text>
                {(isTarget || isInvalidation) && (
                  <text
                    x={labelX + 68}
                    y={y + 13}
                    textAnchor="middle"
                    className={isInvalidation ? 'invalidation-price' : 'target-price'}
                  >
                    {formatPrice(level.price)}
                  </text>
                )}
              </g>
            );
          })}

          {showScenario &&
            model.projectedScenario &&
            model.projectedScenario.length > 1 &&
            (() => {
              const validPoints = model.projectedScenario
                .map((point) => {
                  const x = timeToX(point.time);
                  const y = priceToY(point.price);
                  if (x === null || y === null) return null;
                  return { ...point, x, y };
                })
                .filter(Boolean) as Array<ProjectedScenarioPoint & { x: number; y: number }>;
              if (validPoints.length < 2) return null;
              const points = validPoints.map((point) => `${point.x},${point.y}`).join(' ');
              return (
                <g>
                  <polyline points={points} fill="none" className="projected-path" filter="url(#cyanGlow)" />
                  {validPoints.map((point) => (
                    <circle key={`scenario-${point.id}`} cx={point.x} cy={point.y} r={3.5} className="scenario-point" />
                  ))}
                </g>
              );
            })()}

          {(() => {
            const price = finite(model.currentPrice) ?? latest!.close;
            const y = priceToY(price);
            if (y === null) return null;
            return (
              <g>
                <line x1={plotLeft} y1={y} x2={plotRight} y2={y} className="current-price-line" />
                <rect
                  x={plotRight}
                  y={y - 18}
                  width={dimensions.priceAxisWidth}
                  height={36}
                  className="current-price-box"
                />
                <text
                  x={plotRight + dimensions.priceAxisWidth / 2}
                  y={y + 6}
                  textAnchor="middle"
                  className="current-price-label"
                >
                  {formatPrice(price)}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      <div className="chart-footer">
        <div className="range-controls">
          {['5Y', '1Y', '6M', '3M', '1M', '1W', '1D'].map((range) => (
            <button key={range} type="button">
              {range}
            </button>
          ))}
        </div>
        <div className="chart-status">
          <span>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (
            {model.timezoneLabel || 'UTC+1'})
          </span>
          <span className="footer-divider" />
          <button type="button">%</button>
          <button type="button">log</button>
          <button className="auto-button" type="button">
            auto
          </button>
        </div>
      </div>
    </div>
  );
}
