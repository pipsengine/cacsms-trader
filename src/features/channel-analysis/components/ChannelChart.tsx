import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelSnapshot, TouchRole } from '../types';
import { barTime, isValid, num } from '../format';

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
function cardAxisTime(ms: number, tf: ChannelSnapshot['timeframe']): string {
  const d = new Date(ms);
  const mon = AXIS_MON[d.getUTCMonth()];
  if (tf === 'Y' || tf === 'Q') return String(d.getUTCFullYear());
  if (tf === 'MN') return `${mon} ${d.getUTCFullYear()}`;
  if (tf === 'H8' || tf === 'H1') return `${d.getUTCDate()} ${mon}`;
  return `${d.getUTCDate()} ${mon}`;
}

const ROLE_COLOR: Record<TouchRole, string> = {
  ANCHOR: '#ffd468',
  CANDIDATE: '#ffa94d',
  VALIDATION: '#31dfa1',
  CONFIRMATION: '#59b9ff',
  OPPOSITE: '#c49bff',
};

type Props = {
  channel: ChannelSnapshot;
  height?: number;
  detail?: boolean;
  /** Price and time axes on the summary card, matching the Channel Analysis design. */
  axes?: boolean;
};

/** Candles from Stage 1 with the channel boundaries recomputed from the persisted definition (sloped, per bar). */
export function ChannelChart({ channel, height = 155, detail = false, axes = false }: Props) {
  const [wrapRef, W] = useWidth(detail ? 1100 : 320);
  return (
    <div className="ca-chart-wrap" ref={wrapRef}>
      <ChartSvg channel={channel} height={height} detail={detail} axes={axes} W={W} />
    </div>
  );
}

function ChartSvg({ channel, height = 155, detail = false, axes = false, W }: Props & { W: number }) {
  const H = height;
  const framed = detail || axes;
  const pad = { l: 6, r: detail ? 64 : axes ? 52 : 4, t: 8, b: detail ? 20 : axes ? 16 : 6 };
  const candles = channel.candles;
  const valid = isValid(channel);
  const drawLines = channel.lines.length > 0 && (valid || channel.status === 'FORMING');

  const model = useMemo(() => {
    if (!candles.length) return null;
    const idx = new Map(candles.map((c, i) => [c.time, i]));
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    if (drawLines) {
      for (const l of channel.lines) {
        lo = Math.min(lo, l.lower);
        hi = Math.max(hi, l.upper);
      }
    }
    const live = channel.live?.currentPrice;
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
    return { idx, lo, hi, step, x, y, n };
  }, [candles, channel.lines, channel.live, drawLines, W, H, pad.l, pad.r, pad.t, pad.b]);

  if (!model) {
    return (
      <div className="ca-chart-empty" style={{ height }}>
        No closed candles in Stage 1
      </div>
    );
  }
  const { idx, x, y, step, lo, hi } = model;
  const pts = channel.lines.filter((l) => idx.has(l.time));
  const path = (key: 'upper' | 'lower' | 'mid') =>
    pts.map((l, i) => `${i ? 'L' : 'M'}${x(idx.get(l.time)!).toFixed(1)},${y(l[key]).toFixed(1)}`).join(' ');
  const band =
    pts.length > 1
      ? `${path('upper')} ${pts
          .slice()
          .reverse()
          .map((l) => `L${x(idx.get(l.time)!).toFixed(1)},${y(l.lower).toFixed(1)}`)
          .join(' ')} Z`
      : '';
  const bw = Math.max(1, Math.min(9, step * 0.62));
  const touches = channel.evidence.touches.filter((t) => idx.has(t.time));
  const swings = detail ? channel.evidence.swings.filter((s) => idx.has(s.time)) : [];
  const livePrice = channel.live?.currentPrice ?? null;
  const last = candles[candles.length - 1];
  const priceLine = livePrice ?? last.close;
  const digits = channel.digits;
  const grid = framed ? [0.25, 0.5, 0.75].map((f) => lo + (hi - lo) * f) : [];
  const breakoutAt = channel.breakout?.time;
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
      aria-label={`${channel.timeframe} candles ${valid ? 'with channel boundaries' : '— no valid channel'}`}
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
      {drawLines && band && <path className={`band${valid ? '' : ' forming'}`} d={band} />}
      {candles.map((c, i) => {
        const up = c.close >= c.open;
        const top = y(Math.max(c.open, c.close));
        const h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        return (
          <g key={c.time} className={up ? 'up' : 'down'}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} />
            <rect x={x(i) - bw / 2} y={top} width={bw} height={h} />
          </g>
        );
      })}
      {drawLines && pts.length > 1 && (
        <g className={valid ? '' : 'forming'}>
          <path className="boundary" d={path('upper')} fill="none" />
          <path className="boundary" d={path('lower')} fill="none" />
          <path className="mid" d={path('mid')} fill="none" />
        </g>
      )}
      {detail && <line className="price" x1={pad.l} x2={W - pad.r} y1={y(priceLine)} y2={y(priceLine)} />}
      {detail && (
        <text className="price-label" x={W - pad.r + 4} y={y(priceLine) + 3}>
          {num(priceLine, digits)}
        </text>
      )}
      {breakoutAt != null && idx.has(breakoutAt) && (
        <line className="breakout" x1={x(idx.get(breakoutAt)!)} x2={x(idx.get(breakoutAt)!)} y1={pad.t} y2={H - pad.b} />
      )}
      {swings.map((s) => (
        <circle key={s.id} className="swing" cx={x(idx.get(s.time)!)} cy={y(s.price)} r={2.4}>
          <title>{`${s.kind === 'HIGH' ? 'Swing high' : 'Swing low'} ${num(s.price, digits)} · ${barTime(s.time, channel.timeframe)}`}</title>
        </circle>
      ))}
      {detail &&
        drawLines &&
        touches.map((t) => (
          <circle key={t.id} cx={x(idx.get(t.time)!)} cy={y(t.price)} r={detail ? 5 : 3.2} fill={ROLE_COLOR[t.role]} className="touch">
            <title>{`${t.label} · ${t.boundary.toLowerCase()} · ${num(t.price, digits)} · ${barTime(t.time, channel.timeframe)}`}</title>
          </circle>
        ))}
      {detail &&
        drawLines &&
        touches.map((t) => (
          <text key={`${t.id}-l`} className="touch-label" x={x(idx.get(t.time)!) + 6} y={y(t.price) + (t.boundary === 'UPPER' ? -7 : 13)}>
            {t.role === 'OPPOSITE' ? 'Opp' : `#${t.label.match(/#(\d+)/)?.[1] ?? ''}`}
          </text>
        ))}
      {framed && (
        <g className="ca-axis">
          {timeIdx.map((i) => (
            <text key={candles[i].time} x={x(i)} y={H - 3} textAnchor={i === 0 ? 'start' : i === candles.length - 1 ? 'end' : 'middle'}>
              {detail ? barTime(candles[i].time, channel.timeframe) : cardAxisTime(candles[i].time, channel.timeframe)}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}
