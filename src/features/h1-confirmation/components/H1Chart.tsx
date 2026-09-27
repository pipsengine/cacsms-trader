import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { priceDigits } from '../../htf-vision/components/VisionChart';
import type { H1ChartChannel, H1Event, H1Setup, H1Swing } from '../types';

type Candle = { ts: number; open: number; high: number; low: number; close: number };

type Props = {
  candles: Candle[];
  swings: H1Swing[];
  events: H1Event[];
  channels: H1ChartChannel[];
  setup: H1Setup | null;
  invalidation: number | null;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  livePrice: number | null;
  height?: number;
};

const M = { l: 6, r: 70, t: 16, b: 24 };
const ZOOMS = [60, 120, 180] as const;
const CH_COLOR: Record<'D1' | 'H8', string> = { D1: '#3fb6ff', H8: '#b58cff' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** H1 bar timestamps are broker server time; labelled as-is so bars match the MT5 terminal. */
export function h1Label(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

export function H1Chart({ candles, swings, events, channels, setup, invalidation, direction, livePrice, height: fullHeight = 420 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const height = width < 520 ? Math.min(fullHeight, 320) : fullHeight;
  const [visible, setVisible] = useState<number>(120);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [show, setShow] = useState({ channels: true, structure: true, zones: true });
  const drag = useRef<{ x: number; offset: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const axis = useMemo(() => {
    const ts = candles.map((c) => c.ts);
    const last = ts[ts.length - 1] ?? 0;
    return ts.concat(Array.from({ length: 6 }, (_, k) => last + (k + 1) * 3600));
  }, [candles]);
  const total = axis.length;
  const span = Math.min(total, visible <= 0 ? total : visible);
  const maxOffset = Math.max(0, total - span);
  const off = Math.min(offset, maxOffset);
  const end = total - off;
  const start = Math.max(0, end - span);

  const firstTs = candles.length ? candles[0].ts : 0;
  useEffect(() => {
    setOffset(0);
  }, [firstTs]);

  const tsToIdx = useCallback(
    (ts: number): number => {
      if (!axis.length) return 0;
      if (ts <= axis[0]) return (ts - axis[0]) / 3600;
      if (ts >= axis[axis.length - 1]) return axis.length - 1 + (ts - axis[axis.length - 1]) / 3600;
      let lo = 0;
      let hi = axis.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (axis[mid] <= ts) lo = mid;
        else hi = mid;
      }
      return lo + (ts - axis[lo]) / Math.max(1, axis[hi] - axis[lo]);
    },
    [axis],
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
    const lim = range * 0.25;
    const extra = [invalidation, livePrice, setup?.fib?.f382, setup?.fib?.f786].filter((v): v is number => v != null && Number.isFinite(v));
    for (const v of extra) {
      lo = Math.min(lo, Math.max(v, lo - lim));
      hi = Math.max(hi, Math.min(v, hi + lim));
    }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [candles, start, end, invalidation, livePrice, setup]);

  const y = (p: number) => M.t + ((yMax - p) / (yMax - yMin || 1)) * plotH;
  const digits = priceDigits(candles[candles.length - 1]?.close ?? livePrice);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setVisible((v) => {
        const cur = v <= 0 ? total : v;
        return Math.max(30, Math.min(total, Math.round(cur * (e.deltaY > 0 ? 1.15 : 0.87))));
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
  const xEvery = Math.max(1, Math.ceil(span / Math.max(2, Math.floor(plotW / 100))));
  const visibleCandles = candles.slice(start, Math.min(end, candles.length));
  const inView = (i: number) => i >= start - 0.5 && i < end;
  const lastIdx = candles.length - 1;
  const up = direction === 'BULLISH';

  const channelPaths = channels.map((ch) => {
    const pts = ch.lines.map((l) => ({ ...l, i: tsToIdx(l.ts) })).filter((p) => p.i >= start - 40 && p.i <= end + 30);
    const line = (k: 'upper' | 'lower') => pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    return { ch, upper: line('upper'), lower: line('lower') };
  });

  const peak = setup?.peak;
  const fib = setup?.fib;
  const zoneFrom = peak ? tsToIdx(peak.ts) : null;
  const trig = setup?.trigger ?? null;

  const hovered = hover != null && hover < candles.length ? candles[hover] : null;
  const hoverSwing = hovered ? swings.find((s) => Math.abs(tsToIdx(s.ts) - hover!) < 0.5) : undefined;
  const hoverEvents = hovered ? events.filter((e) => Math.abs(tsToIdx(e.ts) - hover!) < 0.5) : [];
  const tipLeft = hover != null ? x(hover) : 0;
  const tipRight = tipLeft > width * 0.6;
  const livePos = livePrice != null && Number.isFinite(livePrice) ? y(livePrice) : null;
  const zoomOn = (z: number) => (z <= 0 ? span === total : visible === z);
  const chip = { borderColor: '#2b4d6e', color: '#cfe3f7' };

  return (
    <div className="vc-wrap" ref={wrapRef}>
      <div className="vc-toolbar">
        <div className="hr-chips" role="group" aria-label="Visible bars">
          {ZOOMS.map((z) => (
            <button key={z} type="button" className={zoomOn(z) ? 'on' : ''} style={chip} onClick={() => { setVisible(z); setOffset(0); }}>
              {z} bars
            </button>
          ))}
          <button type="button" className={zoomOn(0) ? 'on' : ''} style={chip} onClick={() => { setVisible(0); setOffset(0); }}>
            All
          </button>
        </div>
        <div className="hr-chips" role="group" aria-label="Overlays">
          {(['channels', 'structure', 'zones'] as const).map((k) => (
            <button key={k} type="button" className={show[k] ? 'on' : ''} style={chip} aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
              {k === 'channels' ? 'D1/H8' : k === 'structure' ? 'BOS/CHoCH' : 'Zones'}
            </button>
          ))}
        </div>
        <div className="vc-legend">
          {channels.map((c) => (
            <span key={c.timeframe}>
              <i style={{ background: CH_COLOR[c.timeframe] }} />
              {c.timeframe} channel
            </span>
          ))}
          <span>
            <i style={{ background: '#20d783' }} />
            BOS/CHoCH up
          </span>
          <span>
            <i style={{ background: '#ff6b7a' }} />
            down / invalidation
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
        aria-label={`H1 price chart, ${candles.length} closed bars, ${swings.length} swings, ${events.length} BOS/CHoCH events`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onKeyDown={onKey}
      >
        <defs>
          <clipPath id="h1c-clip">
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
          .filter((i) => (i - start) % xEvery === 0 && i < candles.length)
          .map((i) => (
            <text key={i} x={x(i)} y={height - 7} textAnchor="middle" className="vc-axis">
              {h1Label(axis[i])}
            </text>
          ))}
        {lastIdx >= start && <rect x={x(lastIdx + 0.5)} y={M.t} width={Math.max(0, M.l + plotW - x(lastIdx + 0.5))} height={plotH} className="vc-future" />}
        <g clipPath="url(#h1c-clip)">
          {show.channels &&
            channelPaths.map(({ ch, upper, lower }) => (
              <g key={ch.timeframe}>
                <path d={upper} className="vc-line" stroke={CH_COLOR[ch.timeframe]} />
                <path d={lower} className="vc-line" stroke={CH_COLOR[ch.timeframe]} />
              </g>
            ))}
          {show.zones && fib && zoneFrom != null && (
            <g className="h1c-zone">
              <rect
                x={x(zoneFrom)}
                y={y(Math.max(fib.f382, fib.f786))}
                width={Math.max(0, x(lastIdx + 3) - x(zoneFrom))}
                height={Math.abs(y(fib.f382) - y(fib.f786))}
              />
              <text x={x(zoneFrom) + 4} y={y(up ? fib.f382 : fib.f786) - 4}>
                Pullback zone 38.2–78.6%{setup?.depth != null ? ` · depth ${(setup.depth * 100).toFixed(0)}%` : ''}
              </text>
            </g>
          )}
          {visibleCandles.map((c, k) => {
            const i = start + k;
            const bull = c.close >= c.open;
            const bw = Math.max(1, slotW * 0.62);
            const top = y(Math.max(c.open, c.close));
            const bh = Math.max(1, Math.abs(y(c.open) - y(c.close)));
            return (
              <g key={c.ts} className={bull ? 'vc-up' : 'vc-down'}>
                <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} />
                <rect x={x(i) - bw / 2} y={top} width={bw} height={bh} />
              </g>
            );
          })}
          {show.structure &&
            events.map((e) => {
              const i0 = tsToIdx(e.swingTs);
              const i1 = tsToIdx(e.ts);
              if (i1 < start - 0.5 || i0 >= end) return null;
              const cls = e.side === 'UP' ? 'h1c-bos up' : 'h1c-bos down';
              const ly = y(e.level);
              return (
                <g key={`${e.type}${e.ts}${e.side}`} className={cls}>
                  <line x1={x(i0)} x2={x(i1)} y1={ly} y2={ly} />
                  <text x={(x(i0) + x(i1)) / 2} y={e.side === 'UP' ? ly - 4 : ly + 11} textAnchor="middle">
                    {e.type === 'CHOCH' ? 'CHoCH' : 'BOS'}
                  </text>
                </g>
              );
            })}
          {swings.map((s) => {
            const i = tsToIdx(s.ts);
            if (!inView(i)) return null;
            const cx = x(i);
            const hi = s.kind === 'H';
            const cy = hi ? y(s.price) - 6 : y(s.price) + 6;
            const d = hi ? `M${cx - 3},${cy - 3}L${cx + 3},${cy - 3}L${cx},${cy + 1}Z` : `M${cx - 3},${cy + 3}L${cx + 3},${cy + 3}L${cx},${cy - 1}Z`;
            return (
              <g key={`${s.kind}${s.ts}`}>
                <path d={d} className="vc-swing" />
                {s.label.length === 2 && (
                  <text x={cx} y={hi ? cy - 6 : cy + 13} textAnchor="middle" className={`h1c-label ${s.label === 'HH' || s.label === 'HL' ? 'up' : 'down'}`}>
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
          {show.zones && setup?.extreme && inView(tsToIdx(setup.extreme.ts)) && (
            <circle className="h1c-extreme" cx={x(tsToIdx(setup.extreme.ts))} cy={y(setup.extreme.price)} r={5} />
          )}
          {trig && inView(tsToIdx(trig.ts)) && (
            <g className={`h1c-trigger ${trig.side === 'UP' ? 'up' : 'down'}`}>
              {(() => {
                const cx = x(tsToIdx(trig.ts));
                const cy = y(trig.price);
                const u = trig.side === 'UP';
                return (
                  <>
                    <path d={u ? `M${cx},${cy + 16}L${cx - 5},${cy + 24}L${cx + 5},${cy + 24}Z` : `M${cx},${cy - 16}L${cx - 5},${cy - 24}L${cx + 5},${cy - 24}Z`} />
                    <text x={cx} y={u ? cy + 36 : cy - 28} textAnchor="middle">
                      {trig.type === 'CHOCH' ? 'CHoCH' : 'BOS'} trigger
                    </text>
                  </>
                );
              })()}
            </g>
          )}
          {setup?.retest && inView(tsToIdx(setup.retest.ts)) && (
            <g className="vc-mk-retest">
              <path
                d={(() => {
                  const cx = x(tsToIdx(setup.retest!.ts));
                  const cy = y(setup.retest!.price);
                  return `M${cx},${cy - 5}L${cx + 5},${cy}L${cx},${cy + 5}L${cx - 5},${cy}Z`;
                })()}
              />
              <text x={x(tsToIdx(setup.retest.ts))} y={y(setup.retest.price) + (up ? 18 : -10)} textAnchor="middle">
                Retest
              </text>
            </g>
          )}
          {setup?.falseBreakout && inView(tsToIdx(setup.falseBreakout.ts)) && (
            <g className="vc-mk-failed">
              {(() => {
                const cx = x(tsToIdx(setup.falseBreakout!.ts));
                const cy = y(setup.falseBreakout!.price);
                return (
                  <>
                    <path d={`M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx + 4},${cy - 4}L${cx - 4},${cy + 4}`} />
                    <text x={cx} y={cy + (up ? 18 : -10)} textAnchor="middle">
                      False breakout
                    </text>
                  </>
                );
              })()}
            </g>
          )}
        </g>
        {invalidation != null && y(invalidation) >= M.t && y(invalidation) <= M.t + plotH && (
          <g className="h1c-inv">
            <line x1={M.l} x2={M.l + plotW} y1={y(invalidation)} y2={y(invalidation)} />
            <text x={M.l + 6} y={y(invalidation) + (up ? 12 : -5)}>
              Invalidation {invalidation.toFixed(digits)}
            </text>
          </g>
        )}
        {livePos != null && livePos >= M.t && livePos <= M.t + plotH && (
          <g className="vc-live">
            <line x1={M.l} x2={M.l + plotW} y1={livePos} y2={livePos} />
            <rect x={M.l + plotW + 1} y={livePos - 9} width={M.r - 3} height={18} rx={3} />
            <text x={M.l + plotW + 5} y={livePos + 4}>
              {livePrice!.toFixed(digits)}
            </text>
          </g>
        )}
        {hovered && hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + plotH} className="vc-cross" />}
      </svg>
      {hovered && hover != null && (
        <div className="vc-tip" style={tipRight ? { right: `${((width - tipLeft) / width) * 100 + 1}%` } : { left: `${(tipLeft / width) * 100 + 1}%` }}>
          <b>{h1Label(hovered.ts)}</b>
          <span>
            O {hovered.open.toFixed(digits)} · H {hovered.high.toFixed(digits)}
          </span>
          <span>
            L {hovered.low.toFixed(digits)} · C {hovered.close.toFixed(digits)}
          </span>
          {hoverSwing && (
            <span>
              Swing {hoverSwing.label} at {hoverSwing.price.toFixed(digits)}
            </span>
          )}
          {hoverEvents.map((e) => (
            <span key={`${e.type}${e.side}`} className="vc-tip-mk">
              {e.type === 'CHOCH' ? 'CHoCH' : 'BOS'} {e.side.toLowerCase()} through {e.level.toFixed(digits)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
