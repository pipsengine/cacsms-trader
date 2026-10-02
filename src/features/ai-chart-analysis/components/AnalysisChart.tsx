import { useMemo, useRef, useEffect, useState } from 'react';
import type { Annotation } from '../types';

type Candle = { time: number; open: number; high: number; low: number; close: number; complete?: boolean };
type Line = { time: number; upper: number; lower: number; mid: number };

const OVERLAY_KEYS = [
  'channels',
  'supertrend',
  'swings',
  'structure',
  'erz',
  'annotations',
] as const;

export type OverlayKey = (typeof OVERLAY_KEYS)[number];

export function AnalysisChart({
  candles,
  lines,
  annotations,
  overlays,
  onSelectAnnotation,
}: {
  candles: Candle[];
  lines?: Line[];
  annotations?: Annotation[];
  overlays: Record<OverlayKey, boolean>;
  onSelectAnnotation?: (a: Annotation) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    if (!candles.length) return null;
    const pad = { t: 12, r: 12, b: 24, l: 48 };
    const h = 320;
    const vis = candles.slice(-Math.min(candles.length, Math.floor((width - pad.l - pad.r) / 5)));
    let lo = Infinity;
    let hi = -Infinity;
    vis.forEach((c) => {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    });
    if (overlays.channels && lines?.length) {
      lines.forEach((l) => {
        lo = Math.min(lo, l.lower, l.mid, l.upper);
        hi = Math.max(hi, l.lower, l.mid, l.upper);
      });
    }
    if (!Number.isFinite(lo)) return null;
    const span = hi - lo || 1;
    const x = (i: number) => pad.l + (i / Math.max(vis.length - 1, 1)) * (width - pad.l - pad.r);
    const y = (p: number) => pad.t + (1 - (p - lo) / span) * (h - pad.t - pad.b);
    return { vis, pad, h, x, y, lo, hi };
  }, [candles, lines, overlays.channels, width]);

  return (
    <div className="aca-chart-wrap" ref={ref}>
      {!geom ? (
        <div className="aca-empty">No chart candles for this timeframe</div>
      ) : (
        <svg width={width} height={geom.h} className="aca-chart">
          {overlays.channels &&
            lines?.map((l, i) => (
              <g key={i} opacity={0.55}>
                <line x1={geom.pad.l} x2={width - geom.pad.r} y1={geom.y(l.upper)} y2={geom.y(l.upper)} stroke="var(--accent)" strokeDasharray="4 3" />
                <line x1={geom.pad.l} x2={width - geom.pad.r} y1={geom.y(l.lower)} y2={geom.y(l.lower)} stroke="var(--accent)" strokeDasharray="4 3" />
              </g>
            ))}
          {geom.vis.map((c, i) => {
            const up = c.close >= c.open;
            const cx = geom.x(i);
            const bw = Math.max(2, (width - geom.pad.l - geom.pad.r) / geom.vis.length - 1);
            const bodyTop = geom.y(Math.max(c.open, c.close));
            const bodyBot = geom.y(Math.min(c.open, c.close));
            const wickTop = geom.y(c.high);
            const wickBot = geom.y(c.low);
            const incomplete = c.complete === false;
            return (
              <g key={c.time} opacity={incomplete ? 0.45 : 1}>
                <line x1={cx} x2={cx} y1={wickTop} y2={wickBot} stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth={1} />
                <rect x={cx - bw / 2} y={bodyTop} width={bw} height={Math.max(1, bodyBot - bodyTop)} fill={up ? 'var(--green)' : 'var(--red)'} />
              </g>
            );
          })}
          {overlays.annotations &&
            annotations?.map((a) => {
              if (a.price == null) return null;
              const idx = geom.vis.findIndex((c) => c.time === a.candleTimestamp);
              const i = idx >= 0 ? idx : geom.vis.length - 1;
              const cx = geom.x(i);
              const cy = geom.y(a.price);
              return (
                <g key={a.id} className="aca-ann" onClick={() => onSelectAnnotation?.(a)} style={{ cursor: 'pointer' }}>
                  <circle cx={cx} cy={cy} r={7} fill="var(--surface-2)" stroke="var(--amber)" strokeWidth={1.5} />
                  <text x={cx} y={cy + 3} textAnchor="middle" fontSize={9} fill="var(--text)">
                    {a.index ?? '•'}
                  </text>
                </g>
              );
            })}
        </svg>
      )}
    </div>
  );
}

export { OVERLAY_KEYS };
