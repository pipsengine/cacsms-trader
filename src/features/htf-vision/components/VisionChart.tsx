import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartCandle, ChartLine, ChartSwing, Touch, VisionTf } from '../types';

export type ChartChannel = { key: string; label: string; tf: VisionTf; lines: ChartLine[]; tone: 'primary' | 'secondary' | 'nested' };
export type ChartLevel = { price: number; label: string; color: string };
export type ChartTouch = Touch & { tf: VisionTf };
export type ChartMarker = {
  ts: number;
  price: number;
  kind: 'BREAKOUT' | 'RETEST' | 'FAILED' | 'VALIDATED';
  side?: 'UP' | 'DOWN';
  label: string;
};

type Props = {
  tf: VisionTf;
  candles: ChartCandle[];
  channels: ChartChannel[];
  swings: ChartSwing[];
  touches: ChartTouch[];
  markers: ChartMarker[];
  levels?: ChartLevel[];
  livePrice: number | null;
  liveLabel?: string;
  position: number | null;
  height?: number;
};

const M = { l: 6, r: 70, t: 16, b: 24 };
const ZOOMS = [60, 120, 240] as const;
const ROLE_COLOR: Record<Touch['role'], string> = {
  ANCHOR: '#ffd468',
  CANDIDATE: '#ffa94d',
  VALIDATION: '#20d783',
  CONFIRMATION: '#59b9ff',
  OPPOSITE: '#c49bff',
};
const ROLE_LABEL: Record<Touch['role'], string> = {
  ANCHOR: '#1 anchor',
  CANDIDATE: '#2 candidate',
  VALIDATION: '#3 validation',
  CONFIRMATION: 'confirmation',
  OPPOSITE: 'opposite',
};
const TONE = {
  primary: { stroke: '#3fb6ff', fill: 'rgba(63,182,255,0.08)', width: 2.6, dash: undefined as string | undefined },
  secondary: { stroke: '#b58cff', fill: 'rgba(181,140,255,0.05)', width: 1.6, dash: '7 4' },
  nested: { stroke: '#ffb020', fill: 'rgba(255,176,32,0.05)', width: 1.5, dash: '3 3' },
};

export function priceDigits(p: number | null | undefined): number {
  if (p == null || !Number.isFinite(p)) return 5;
  const a = Math.abs(p);
  return a >= 1000 ? 2 : a >= 20 ? 3 : 5;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Bar timestamps are broker server time; they are labelled as-is so bars match the MT5 terminal. */
export function barLabel(ts: number, tf: VisionTf, withYear = false): string {
  const d = new Date(ts * 1000);
  const day = `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]}`;
  if (tf === 'H8' || tf === 'H1') return `${day} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
  return withYear ? `${day} ${String(d.getUTCFullYear()).slice(2)}` : day;
}

function interp(lines: ChartLine[], ts: number): { lower: number; upper: number } | null {
  if (!lines.length || ts < lines[0].ts || ts > lines[lines.length - 1].ts) return null;
  let lo = 0;
  let hi = lines.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].ts <= ts) lo = mid;
    else hi = mid;
  }
  const a = lines[lo];
  const b = lines[hi];
  if (a.ts === ts || a === b) return { lower: a.lower, upper: a.upper };
  if (b.ts === ts) return { lower: b.lower, upper: b.upper };
  const f = (ts - a.ts) / (b.ts - a.ts);
  return { lower: a.lower + (b.lower - a.lower) * f, upper: a.upper + (b.upper - a.upper) * f };
}

export function VisionChart({ tf, candles, channels, swings, touches, markers, levels = [], livePrice, liveLabel, position, height: fullHeight = 400 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const height = width < 520 ? Math.min(fullHeight, 320) : fullHeight;
  const [visible, setVisible] = useState<number>(120);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const primary = channels.find((c) => c.tone === 'primary') ?? channels[0];
  const lastTs = candles.length ? candles[candles.length - 1].ts : 0;

  /** Slot axis: closed candles followed by projected boundary slots of the drawn timeframe. */
  const axis = useMemo(() => {
    const ts = candles.map((c) => c.ts);
    const own = channels.find((c) => c.tf === tf);
    const future = (own?.lines ?? []).filter((l) => l.ts > lastTs).map((l) => l.ts);
    return ts.concat(future.slice(0, 12));
  }, [candles, channels, tf, lastTs]);

  const total = axis.length;
  const span = Math.min(total, visible <= 0 ? total : visible);
  const maxOffset = Math.max(0, total - span);
  const off = Math.min(offset, maxOffset);
  const end = total - off;
  const start = Math.max(0, end - span);

  const firstTs = candles.length ? candles[0].ts : 0;
  useEffect(() => {
    setOffset(0);
  }, [tf, firstTs]);

  const step = useMemo(() => {
    const d: number[] = [];
    for (let i = Math.max(1, axis.length - 30); i < axis.length; i++) d.push(axis[i] - axis[i - 1]);
    d.sort((a, b) => a - b);
    return d.length ? d[d.length >> 1] : tf === 'D1' ? 86400 : 28800;
  }, [axis, tf]);

  const tsToIdx = useCallback(
    (ts: number): number => {
      if (!axis.length) return 0;
      if (ts <= axis[0]) return (ts - axis[0]) / step;
      if (ts >= axis[axis.length - 1]) return axis.length - 1 + (ts - axis[axis.length - 1]) / step;
      let lo = 0;
      let hi = axis.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (axis[mid] <= ts) lo = mid;
        else hi = mid;
      }
      return lo + (ts - axis[lo]) / Math.max(1, axis[hi] - axis[lo]);
    },
    [axis, step],
  );

  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;
  const slotW = plotW / Math.max(1, span);
  const x = (idx: number) => M.l + (idx - start + 0.5) * slotW;

  const [yMin, yMax] = useMemo(() => {
    const vis = candles.slice(start, Math.min(end, candles.length));
    if (!vis.length) return [0, 1];
    let lo = Math.min(...vis.map((c) => c.low));
    let hi = Math.max(...vis.map((c) => c.high));
    const range = hi - lo || Math.abs(hi) * 0.01 || 1;
    const lim = range * 0.35;
    const t0 = axis[start];
    const t1 = axis[Math.max(start, end - 1)];
    for (const ch of channels) {
      for (const l of ch.lines) {
        if (l.ts < t0 || l.ts > t1) continue;
        lo = Math.min(lo, Math.max(l.lower, lo - lim));
        hi = Math.max(hi, Math.min(l.upper, hi + lim));
      }
    }
    if (livePrice != null && Number.isFinite(livePrice)) {
      lo = Math.min(lo, livePrice);
      hi = Math.max(hi, livePrice);
    }
    for (const lvl of levels) {
      if (Number.isFinite(lvl.price)) {
        lo = Math.min(lo, lvl.price);
        hi = Math.max(hi, lvl.price);
      }
    }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [candles, channels, start, end, axis, livePrice, levels]);

  const y = (p: number) => M.t + ((yMax - p) / (yMax - yMin || 1)) * plotH;
  const digits = priceDigits(candles[candles.length - 1]?.close ?? livePrice);

  /* Wheel zoom needs a non-passive listener to stop page scroll. */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setVisible((v) => {
        const cur = v <= 0 ? total : v;
        const next = Math.round(cur * (e.deltaY > 0 ? 1.15 : 0.87));
        return Math.max(30, Math.min(total, next));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [total]);

  const idxFromEvent = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const px = ((clientX - r.left) / r.width) * width;
    if (px < M.l || px > M.l + plotW) return null;
    return Math.max(start, Math.min(end - 1, Math.floor((px - M.l) / slotW) + start));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, offset: off };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const r = svgRef.current?.getBoundingClientRect();
      const scale = r ? width / r.width : 1;
      const dBars = Math.round(((e.clientX - drag.current.x) * scale) / slotW);
      setOffset(Math.max(0, Math.min(maxOffset, drag.current.offset + dBars)));
    }
    setHover(idxFromEvent(e.clientX));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setOffset((o) => Math.min(maxOffset, o + Math.max(1, Math.round(span / 10))));
    else if (e.key === 'ArrowRight') setOffset((o) => Math.max(0, o - Math.max(1, Math.round(span / 10))));
    else if (e.key === '+' || e.key === '=') setVisible((v) => Math.max(30, Math.round((v <= 0 ? total : v) * 0.8)));
    else if (e.key === '-') setVisible((v) => Math.min(total, Math.round((v <= 0 ? total : v) * 1.25)));
    else return;
    e.preventDefault();
  };

  if (!candles.length) return null;

  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + ((yMax - yMin) * (i + 0.5)) / 6);
  const xEvery = Math.max(1, Math.ceil(span / Math.max(2, Math.floor(plotW / 90))));
  const visibleCandles = candles.slice(start, Math.min(end, candles.length));

  const channelPaths = channels.map((ch) => {
    const pts = ch.lines.map((l) => ({ ...l, i: tsToIdx(l.ts) })).filter((p) => p.i >= start - 2 && p.i <= end + 1);
    const hist = pts.filter((p) => !p.projected);
    const proj = pts.filter((p) => p.projected);
    if (hist.length && proj.length) proj.unshift(hist[hist.length - 1]);
    const path = (arr: typeof pts, k: 'upper' | 'lower') => arr.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const band = (arr: typeof pts) =>
      arr.length < 2
        ? ''
        : `${path(arr, 'upper')}${[...arr].reverse().map((p) => `L${x(p.i).toFixed(1)},${y(p.lower).toFixed(1)}`).join('')}Z`;
    const mid = hist.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y((p.upper + p.lower) / 2).toFixed(1)}`).join('');
    return { ch, hist, proj, path, band, mid };
  });

  const hovered = hover != null && hover < candles.length ? candles[hover] : null;
  const hoverBounds = hovered && primary ? interp(primary.lines, hovered.ts) : null;
  const hoverTouches = hovered ? touches.filter((t) => Math.abs(tsToIdx(t.ts) - hover!) < 0.5) : [];
  const hoverMarkers = hovered ? markers.filter((m) => Math.abs(tsToIdx(m.ts) - hover!) < 0.5) : [];
  const tipLeft = hover != null ? x(hover) : 0;
  const tipRight = tipLeft > width * 0.6;

  const livePos = livePrice != null && Number.isFinite(livePrice) ? y(livePrice) : null;
  const zoomOn = (z: number) => (z <= 0 ? span === total : visible === z);

  return (
    <div className="vc-wrap" ref={wrapRef}>
      <div className="vc-toolbar">
        <div className="hr-chips" role="group" aria-label="Visible bars">
          {ZOOMS.map((z) => (
            <button key={z} type="button" className={zoomOn(z) ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => { setVisible(z); setOffset(0); }}>
              {z} bars
            </button>
          ))}
          <button type="button" className={zoomOn(0) ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => { setVisible(0); setOffset(0); }}>
            All
          </button>
        </div>
        <div className="vc-legend">
          {channels.map((c) => (
            <span key={c.key}>
              <i style={{ background: TONE[c.tone].stroke }} />
              {c.label}
            </span>
          ))}
          <span>
            <i className="vc-dot" style={{ background: ROLE_COLOR.ANCHOR }} />
            Touch #1–#3
          </span>
          <span>
            <i className="vc-dot" style={{ background: ROLE_COLOR.OPPOSITE }} />
            Opposite
          </span>
          <span>
            <i className="vc-tri" />
            Swings
          </span>
        </div>
        <small className="vc-hint">Wheel / +− to zoom · drag / ←→ to pan</small>
      </div>
      <svg
        ref={svgRef}
        className="vc-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`${tf} price chart with ${channels.map((c) => c.label).join(' and ') || 'no channel'}; ${candles.length} closed bars`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onKeyDown={onKey}
      >
        <defs>
          <clipPath id={`vc-clip-${tf}`}>
            <rect x={M.l} y={M.t} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={M.l + plotW} y1={y(v)} y2={y(v)} className="vc-grid" />
            <text x={M.l + plotW + 6} y={y(v) + 3} className="vc-axis">
              {v.toFixed(digits)}
            </text>
          </g>
        ))}
        {Array.from({ length: span }, (_, k) => start + k)
          .filter((i) => (i - start) % xEvery === 0)
          .map((i) => (
            <text key={i} x={x(i)} y={height - 7} textAnchor="middle" className="vc-axis">
              {barLabel(axis[i], tf, tf === 'D1' && span > 200)}
            </text>
          ))}
        {total > candles.length && candles.length - 1 >= start && (
          <rect x={x(candles.length - 0.5)} y={M.t} width={Math.max(0, M.l + plotW - x(candles.length - 0.5))} height={plotH} className="vc-future" />
        )}
        <g clipPath={`url(#vc-clip-${tf})`}>
          {levels.map((lvl) => (
            <g key={lvl.label}>
              <line x1={M.l} x2={M.l + plotW} y1={y(lvl.price)} y2={y(lvl.price)} stroke={lvl.color} strokeDasharray="2 4" />
              <text x={M.l + 6} y={y(lvl.price) - 3} fill={lvl.color} fontSize="10">
                {lvl.label}
              </text>
            </g>
          ))}
          {channelPaths.map(({ ch, hist, proj, path, band, mid }) => (
            <g key={ch.key}>
              <path d={band(hist)} fill={TONE[ch.tone].fill} />
              <path d={band(proj)} fill={TONE[ch.tone].fill} opacity={0.6} />
              <path d={mid} className="vc-mid" stroke={TONE[ch.tone].stroke} />
              <path d={path(hist, 'upper')} className="vc-line" stroke={TONE[ch.tone].stroke} style={{ strokeWidth: TONE[ch.tone].width, strokeDasharray: TONE[ch.tone].dash }} />
              <path d={path(hist, 'lower')} className="vc-line" stroke={TONE[ch.tone].stroke} style={{ strokeWidth: TONE[ch.tone].width, strokeDasharray: TONE[ch.tone].dash }} />
              <path d={path(proj, 'upper')} className="vc-line vc-proj" stroke={TONE[ch.tone].stroke} style={{ strokeWidth: TONE[ch.tone].width, strokeDasharray: TONE[ch.tone].dash }} />
              <path d={path(proj, 'lower')} className="vc-line vc-proj" stroke={TONE[ch.tone].stroke} style={{ strokeWidth: TONE[ch.tone].width, strokeDasharray: TONE[ch.tone].dash }} />
            </g>
          ))}
          {visibleCandles.map((c, k) => {
            const i = start + k;
            const up = c.close >= c.open;
            const bw = Math.max(1, slotW * 0.62);
            const top = y(Math.max(c.open, c.close));
            const bh = Math.max(1, Math.abs(y(c.open) - y(c.close)));
            return (
              <g key={c.ts} className={up ? 'vc-up' : 'vc-down'}>
                <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} />
                <rect x={x(i) - bw / 2} y={top} width={bw} height={bh} />
              </g>
            );
          })}
          {swings.map((s) => {
            const i = tsToIdx(s.ts);
            if (i < start || i >= end) return null;
            const cx = x(i);
            const cy = s.kind === 'H' ? y(s.price) - 7 : y(s.price) + 7;
            const d = s.kind === 'H' ? `M${cx - 3},${cy - 3}L${cx + 3},${cy - 3}L${cx},${cy + 1}Z` : `M${cx - 3},${cy + 3}L${cx + 3},${cy + 3}L${cx},${cy - 1}Z`;
            return <path key={`${s.kind}${s.ts}`} d={d} className="vc-swing" />;
          })}
          {markers.map((m) => {
            const i = tsToIdx(m.ts);
            if (i < start - 0.5 || i >= end) return null;
            const cx = x(i);
            if (m.kind === 'VALIDATED') {
              const flip = cx > M.l + plotW * 0.7;
              return (
                <g key={`${m.kind}${m.ts}`} className="vc-validated">
                  <line x1={cx} x2={cx} y1={M.t} y2={M.t + plotH} />
                  <text x={flip ? cx - 4 : cx + 4} y={M.t + 10} textAnchor={flip ? 'end' : 'start'}>
                    {m.label}
                  </text>
                </g>
              );
            }
            const cy = y(m.price);
            const upSide = m.side === 'UP';
            const ty = upSide ? cy - 16 : cy + 22;
            const cls = m.kind === 'BREAKOUT' ? 'vc-mk-break' : m.kind === 'RETEST' ? 'vc-mk-retest' : 'vc-mk-failed';
            return (
              <g key={`${m.kind}${m.ts}${m.side}`} className={cls}>
                {m.kind === 'FAILED' ? (
                  <path d={`M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx + 4},${cy - 4}L${cx - 4},${cy + 4}`} />
                ) : m.kind === 'RETEST' ? (
                  <path d={`M${cx},${cy - 5}L${cx + 5},${cy}L${cx},${cy + 5}L${cx - 5},${cy}Z`} />
                ) : (
                  <path d={upSide ? `M${cx},${cy - 12}L${cx - 5},${cy - 4}L${cx + 5},${cy - 4}Z` : `M${cx},${cy + 12}L${cx - 5},${cy + 4}L${cx + 5},${cy + 4}Z`} />
                )}
                <text x={cx} y={ty} textAnchor="middle">
                  {m.label}
                </text>
              </g>
            );
          })}
          {touches.map((t) => {
            const i = tsToIdx(t.ts);
            if (i < start - 0.5 || i >= end) return null;
            const cx = x(i);
            const cy = y(t.price);
            const key3 = t.role === 'ANCHOR' || t.role === 'CANDIDATE' || t.role === 'VALIDATION';
            const below = t.boundary === 'LOWER';
            return (
              <g key={`${t.tf}${t.seq}${t.ts}`} className="vc-touch">
                <circle cx={cx} cy={cy} r={key3 ? 5.5 : 4} fill={ROLE_COLOR[t.role]} fillOpacity={key3 ? 0.95 : 0.55} stroke="#07111f" />
                {key3 && (
                  <text x={cx} y={below ? cy + 17 : cy - 10} textAnchor="middle" fill={ROLE_COLOR[t.role]}>
                    {channels.length > 1 ? `${t.tf} ` : ''}#{t.role === 'ANCHOR' ? 1 : t.role === 'CANDIDATE' ? 2 : 3}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {livePos != null && livePos >= M.t && livePos <= M.t + plotH && (
          <g className="vc-live">
            <line x1={M.l} x2={M.l + plotW} y1={livePos} y2={livePos} />
            <rect x={M.l + plotW + 1} y={livePos - 9} width={M.r - 3} height={18} rx={3} />
            <text x={M.l + plotW + 5} y={livePos + 4}>
              {livePrice!.toFixed(digits)}
            </text>
            {position != null && (
              <text x={M.l + plotW - 6} y={livePos - 5} textAnchor="end" className="vc-pos">
                {liveLabel ? `${liveLabel} · ` : ''}
                {position.toFixed(0)}% of channel
              </text>
            )}
          </g>
        )}
        {hovered && hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + plotH} className="vc-cross" />
        )}
      </svg>
      {hovered && hover != null && (
        <div className="vc-tip" style={tipRight ? { right: `${((width - tipLeft) / width) * 100 + 1}%` } : { left: `${(tipLeft / width) * 100 + 1}%` }}>
          <b>{barLabel(hovered.ts, tf, true)}</b>
          <span>
            O {hovered.open.toFixed(digits)} · H {hovered.high.toFixed(digits)}
          </span>
          <span>
            L {hovered.low.toFixed(digits)} · C {hovered.close.toFixed(digits)}
          </span>
          {hoverBounds && (
            <>
              <span>
                Upper {hoverBounds.upper.toFixed(digits)} · Lower {hoverBounds.lower.toFixed(digits)}
              </span>
              <span>
                Close at {(((hovered.close - hoverBounds.lower) / (hoverBounds.upper - hoverBounds.lower || 1)) * 100).toFixed(0)}% of {primary?.label}
              </span>
            </>
          )}
          {hoverTouches.map((t) => (
            <span key={`${t.tf}${t.seq}`} style={{ color: ROLE_COLOR[t.role] }}>
              {t.tf} touch {ROLE_LABEL[t.role]} · {t.boundary.toLowerCase()} · {t.deviationAtr >= 0 ? '+' : ''}
              {t.deviationAtr.toFixed(2)} ATR
            </span>
          ))}
          {hoverMarkers.map((m) => (
            <span key={`${m.kind}${m.ts}`} className="vc-tip-mk">
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
