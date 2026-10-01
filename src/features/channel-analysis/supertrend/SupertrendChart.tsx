import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelTimeframe } from '../types';
import { barTime, num } from '../format';
import type { PaintedCandle, SupertrendCardSnapshot, SupertrendTimeframe, TrendDirection } from './types';

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(120, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const AXIS_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function barTimeTf(tf: SupertrendTimeframe): ChannelTimeframe | undefined {
  if (tf === 'D') return 'D1';
  if (tf === 'M15') return undefined;
  if (tf === 'Y' || tf === 'Q' || tf === 'MN' || tf === 'W' || tf === 'H8' || tf === 'H1') return tf as ChannelTimeframe;
  return undefined;
}

function cardAxisTime(ms: number, tf: SupertrendTimeframe): string {
  const d = new Date(ms);
  const mon = AXIS_MON[d.getUTCMonth()];
  if (tf === 'Y') return String(d.getUTCFullYear());
  if (tf === 'Q') return `${d.getUTCDate()} ${mon}`;
  if (tf === 'MN') return `${mon} ${d.getUTCFullYear()}`;
  if (tf === 'W' || tf === 'D') return `${d.getUTCDate()} ${mon}`;
  if (tf === 'H8' || tf === 'H1' || tf === 'M15') {
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  return `${d.getUTCDate()} ${mon}`;
}

function regimeClass(trend: TrendDirection): 'up' | 'down' | 'unknown' {
  if (trend === 'UP') return 'up';
  if (trend === 'DOWN') return 'down';
  return 'unknown';
}

/** Regime paint when ST is ready; otherwise match Channel Analysis OHLC colours. */
function candleClass(c: PaintedCandle): 'up' | 'down' | 'unknown' {
  if (c.trend === 'UP' || c.trend === 'DOWN') return regimeClass(c.trend);
  if (c.close >= c.open) return 'up';
  return 'down';
}

/** Keep candle bodies readable on summary cards (same idea as Channel Analysis chart density). */
function visibleCandles(candles: PaintedCandle[], width: number, padL: number, padR: number, detail: boolean) {
  const computed = candles.filter((c) => c.trend === 'UP' || c.trend === 'DOWN' || c.atr != null);
  const source = computed.length ? computed : candles;
  const minStepPx = detail ? 3 : 7;
  const capacity = Math.max(24, Math.floor((width - padL - padR) / minStepPx));
  return source.slice(-Math.min(source.length, capacity));
}

function buildSupertrendPaths(
  candles: PaintedCandle[],
  x: (i: number) => number,
  y: (p: number) => number,
): { dir: TrendDirection; d: string }[] {
  const segments: { dir: TrendDirection; d: string }[] = [];
  let current: { dir: TrendDirection; parts: string[] } | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const st = c.supertrend;
    if (st == null || !Number.isFinite(st)) continue;
    const dir: TrendDirection = c.trend === 'UP' || c.trend === 'DOWN' ? c.trend : 'UNKNOWN';
    const token: string = `${current?.parts.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(st).toFixed(1)}`;
    if (!current || current.dir !== dir) {
      if (current?.parts.length) segments.push({ dir: current.dir, d: current.parts.join(' ') });
      current = { dir, parts: [token.replace(/^L/, 'M')] };
    } else {
      current.parts.push(token);
    }
  }
  if (current?.parts.length) segments.push({ dir: current.dir, d: current.parts.join(' ') });
  return segments;
}

type Props = {
  card: SupertrendCardSnapshot;
  height?: number;
  detail?: boolean;
  axes?: boolean;
  /** Dashed ST line — visual only until full atrPeriod history exists */
  provisional?: boolean;
};

/** Same candle geometry as Channel Analysis; colours follow Supertrend regime (not OHLC direction). */
export function SupertrendChart({ card, height = 155, detail = false, axes = false, provisional = false }: Props) {
  const [wrapRef, W] = useWidth(detail ? 1100 : 320);
  return (
    <div className={`ca-chart-wrap${provisional ? ' st-preview' : ''}`} ref={wrapRef}>
      <ChartSvg card={card} height={height} detail={detail} axes={axes} provisional={provisional} W={W} />
    </div>
  );
}

function ChartSvg({ card, height = 155, detail = false, axes = false, provisional = false, W }: Props & { W: number }) {
  const H = height;
  const framed = detail || axes;
  const pad = { l: 6, r: detail ? 64 : axes ? 52 : 4, t: 8, b: detail ? 20 : axes ? 16 : 6 };
  const bt = barTimeTf(card.timeframe);

  const candles = useMemo(
    () => visibleCandles(card.candles, W, pad.l, pad.r, detail),
    [card.candles, W, pad.l, pad.r, detail],
  );

  const model = useMemo(() => {
    if (!candles.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.low, c.supertrend ?? c.low);
      hi = Math.max(hi, c.high, c.supertrend ?? c.high);
    }
    const live = card.currentPrice;
    if (live != null) {
      lo = Math.min(lo, live);
      hi = Math.max(hi, live);
    }
    const span = hi - lo || Math.abs(hi) * 0.001 || 1;
    lo -= span * 0.06;
    hi += span * 0.06;
    const n = candles.length;
    const step = (W - pad.l - pad.r) / n;
    const x = (i: number) => pad.l + step * (i + 0.5);
    const y = (p: number) => pad.t + ((hi - p) / (hi - lo)) * (H - pad.t - pad.b);
    return { lo, hi, step, x, y, n };
  }, [candles, card.currentPrice, W, H, pad.l, pad.r, pad.t, pad.b]);

  if (!model) {
    return (
      <div className="ca-chart-empty" style={{ height }}>
        No canonical candles
      </div>
    );
  }

  const { x, y, step, lo, hi } = model;
  const bw = Math.max(3, Math.min(12, step * 0.78));
  const wick = Math.max(1.2, Math.min(2.4, bw * 0.2));
  const minBodyPx = Math.max(2.5, step * 0.32);
  const segments = buildSupertrendPaths(candles, x, y);
  const showSupertrend = segments.length > 0;
  const livePrice = card.currentPrice ?? null;
  const last = candles[candles.length - 1];
  const priceLine = livePrice ?? last?.close;
  const digits = card.digits;
  const grid = framed ? [0.25, 0.5, 0.75].map((f) => lo + (hi - lo) * f) : [];
  const timeIdx = framed
    ? [0, Math.floor((candles.length - 1) / 2), candles.length - 1].filter((v, i, a) => a.indexOf(v) === i)
    : [];

  return (
    <svg
      className={`ca-chart${detail ? ' detail' : ''}${axes && !detail ? ' card' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`${card.timeframe} Supertrend candles`}
    >
      {framed && (
        <g className="ca-grid">
          {grid.map((p) => (
            <g key={p}>
              <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} />
              <text x={W - pad.r + 4} y={y(p) + 3}>
                {num(p, Math.min(digits, detail ? digits : 4))}
              </text>
            </g>
          ))}
        </g>
      )}
      {candles.map((c, i) => {
        const cls = candleClass(c);
        const top = y(Math.max(c.open, c.close));
        const bodyPx = Math.abs(y(c.open) - y(c.close));
        const h = Math.max(minBodyPx, bodyPx);
        const provisional = !c.complete ? ' · provisional' : '';
        return (
          <g key={c.time} className={`${cls}${!c.complete ? ' candle-live' : ''}`}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} strokeWidth={wick} />
            <rect x={x(i) - bw / 2} y={top} width={bw} height={h} />
            <title>{`${barTime(c.time, bt)} O ${num(c.open, digits)} H ${num(c.high, digits)} L ${num(c.low, digits)} C ${num(c.close, digits)} · ${c.trend}${provisional}`}</title>
          </g>
        );
      })}
      {showSupertrend && (
        <g className="st-line-layer" pointerEvents="none">
          {segments.map((s, i) => (
            <path
              key={i}
              className={`supertrend ${s.dir === 'UP' ? 'up' : s.dir === 'DOWN' ? 'down' : 'unknown'}${provisional ? ' provisional' : ''}`}
              d={s.d}
              fill="none"
            />
          ))}
        </g>
      )}
      {detail && priceLine != null && (
        <>
          <line className="price" x1={pad.l} x2={W - pad.r} y1={y(priceLine)} y2={y(priceLine)} />
          <text className="price-label" x={W - pad.r + 4} y={y(priceLine) + 3}>
            {num(priceLine, digits)}
          </text>
        </>
      )}
      {framed && (
        <g className="ca-axis">
          {timeIdx.map((i) => (
            <text key={candles[i].time} x={x(i)} y={H - 3} textAnchor={i === 0 ? 'start' : i === candles.length - 1 ? 'end' : 'middle'}>
              {detail ? barTime(candles[i].time, bt) : cardAxisTime(candles[i].time, card.timeframe)}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}
