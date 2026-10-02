import { useMemo } from 'react';
import { Camera, Expand, SlidersHorizontal } from 'lucide-react';
import { layoutAnnotations } from '../annotationLayout';
import {
  buildChartScale,
  finiteLevels,
  finiteNumber,
  normalizeCandles,
  priceTicks,
} from '../chartMath';
import type { AnalysisResult, Timeframe } from '../types';

const W = 930;
const H = 500;
const pad = { l: 20, r: 70, t: 25, b: 52 };

export function MarketChart({ a, tf, autonomous }: { a: AnalysisResult; tf: Timeframe; autonomous: boolean }) {
  const cs = useMemo(() => normalizeCandles(a.candles), [a.candles]);
  const levels = useMemo(() => finiteLevels(a.levels), [a.levels]);

  const scale = useMemo(() => {
    if (!levels) return null;
    const stPrices = (a.supertrendSeries || []).map((p) => p.value);
    return buildChartScale(
      cs,
      [
        levels.invalidation,
        levels.t1,
        levels.t2,
        levels.supply[0],
        levels.supply[1],
        levels.erz[0],
        levels.erz[1],
        levels.p2,
        ...stPrices,
      ],
      { W, H, pad },
    );
  }, [a.supertrendSeries, cs, levels]);

  const n = cs.length;
  const ready = n >= 2 && scale !== null && levels !== null;

  const annRaw = useMemo(() => {
    if (!ready) return [];
    return a.annotations.filter((z) => {
      const ti = z.timeIndex;
      return ti >= 0 && ti < n && finiteNumber(z.price) !== null;
    });
  }, [a.annotations, n, ready]);

  const channelPaths = useMemo(() => {
    if (!ready || !scale || !a.chartLines?.length) return null;
    const { priceToY, indexToX } = scale;
    const timeToIdx = new Map(cs.map((c, i) => [c.time, i]));
    const upper: string[] = [];
    const lower: string[] = [];
    for (const ln of a.chartLines) {
      const t = finiteNumber(ln.time);
      if (t === null) continue;
      const idx = timeToIdx.get(t);
      if (idx === undefined) continue;
      const x = indexToX(idx);
      const yu = priceToY(ln.upper);
      const yl = priceToY(ln.lower);
      if (yu === null || yl === null) continue;
      upper.push(`${upper.length ? 'L' : 'M'}${x},${yu}`);
      lower.push(`${lower.length ? 'L' : 'M'}${x},${yl}`);
    }
    if (!upper.length) return null;
    return { upper: upper.join(' '), lower: lower.join(' ') };
  }, [a.chartLines, cs, ready, scale]);

  const stSegments = useMemo(() => {
    if (!ready || !scale) return null;
    const { priceToY, indexToX } = scale;
    const timeToIdx = new Map(cs.map((c, i) => [c.time, i]));
    const segs: { d: string; bull: boolean }[] = [];
    let prev: { x: number; y: number; bull: boolean } | null = null;
    const stPoints = a.supertrendSeries?.length ? a.supertrendSeries : null;
    const source = stPoints ?? null;
    if (!source?.length) return null;
    for (const pt of source) {
      const t = finiteNumber(pt.time);
      const val = finiteNumber('value' in pt ? pt.value : null);
      if (t === null || val === null) continue;
      const idx = timeToIdx.get(t);
      if (idx === undefined) continue;
      const c = cs[idx];
      const x = indexToX(idx);
      const y = priceToY(val);
      if (y === null) continue;
      const dir = ('direction' in pt ? pt.direction : '').toUpperCase();
      const bull = dir === 'UP' || dir === 'BULLISH' || (dir !== 'DOWN' && dir !== 'BEARISH' && c.close >= val);
      if (prev) {
        segs.push({ d: `M${prev.x},${prev.y} L${x},${y}`, bull: prev.bull });
      }
      prev = { x, y, bull };
    }
    return segs.length ? segs : null;
  }, [a.supertrendSeries, cs, ready, scale]);

  const channelPoints = useMemo(() => {
    if (!ready || !scale || !levels) return null;
    const { priceToY, indexToX } = scale;
    const i0 = Math.max(0, n - 40);
    const i1 = n - 1;
    const pts = [
      [indexToX(i0), priceToY(levels.supply[0])],
      [indexToX(i1), priceToY(levels.supply[0])],
      [indexToX(i1), priceToY(levels.erz[1])],
      [indexToX(i0), priceToY(levels.erz[0])],
    ] as const;
    if (pts.some((p) => p[1] === null)) return null;
    return pts.map((p) => `${p[0]},${p[1]}`).join(' ');
  }, [levels, n, ready, scale]);

  const stPath = useMemo(() => {
    if (!ready || !scale) return '';
    const { priceToY, indexToX } = scale;
    const step = Math.max(1, Math.floor(n / 24));
    const parts: string[] = [];
    cs.forEach((c, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const px = indexToX(i);
      const py = priceToY(c.close);
      if (py === null) return;
      parts.push(`${parts.length ? 'L' : 'M'}${px},${py}`);
    });
    return parts.join(' ');
  }, [cs, n, ready, scale]);

  const proj = useMemo(() => {
    if (!ready || !scale || !levels) return null;
    const { priceToY, indexToX } = scale;
    const i1 = n - 1;
    const x1 = indexToX(i1);
    const y1 = priceToY(cs[i1].close);
    const yt1 = priceToY(levels.t1);
    const x2 = indexToX(Math.min(n - 1, i1 + 2));
    const yt2 = priceToY(levels.t2);
    if (y1 === null || yt1 === null || yt2 === null) return null;
    const mid = x1 + (x2 - x1) / 2;
    return `M${x1},${y1} Q${mid},${yt1} ${x2},${yt2}`;
  }, [cs, n, levels, ready, scale]);

  if (!ready || !scale || !levels) {
    return (
      <div className="chartCard">
        <div className="chartBody aca-chart-empty">
          {n < 2
            ? 'No closed-bar candles for this timeframe yet.'
            : 'Chart unavailable — invalid or incomplete price data from engines.'}
        </div>
      </div>
    );
  }

  const { priceToY, indexToX, minPrice, maxPrice } = scale;
  const candleW = Math.max(2, ((W - pad.l - pad.r) / n) * 0.58);
  const volMax = Math.max(1, ...cs.map((c) => c.volume));
  const ticks = priceTicks(minPrice, maxPrice);
  const placedAnn = layoutAnnotations(
    annRaw.map((z) => ({
      id: z.id,
      label: z.label,
      tone: z.tone,
      timeIndex: z.timeIndex,
      price: z.price,
      priority: z.priority,
    })),
    indexToX,
    (p) => priceToY(p),
    pad.t,
    H - pad.b,
  );

  const tfLabel = tf;
  const ohlc = a.ohlc;

  return (
    <div className="chartCard">
      <div className="chartHead">
        <div className="instrument">
          <div className="gold">◒</div>
          <div>
            <b>{a.symbol}</b>
            <small>{a.displayName}</small>
          </div>
          <select value={tfLabel} disabled>
            <option>{tfLabel}</option>
          </select>
          <div className="ohlc">
            O {finiteNumber(ohlc.o)?.toFixed(2) ?? '—'} &nbsp; H {finiteNumber(ohlc.h)?.toFixed(2) ?? '—'} &nbsp; L{' '}
            {finiteNumber(ohlc.l)?.toFixed(2) ?? '—'} &nbsp;{' '}
            <b>
              C {finiteNumber(ohlc.c)?.toFixed(2) ?? '—'} &nbsp;{' '}
              {ohlc.change >= 0 ? '+' : ''}
              {finiteNumber(ohlc.change)?.toFixed(2) ?? '—'} ({ohlc.changePct >= 0 ? '+' : ''}
              {finiteNumber(ohlc.changePct)?.toFixed(2) ?? '—'}%)
            </b>
          </div>
        </div>
        <div className="chartBtns">
          <button type="button" aria-label="Chart type">
            ◫
          </button>
          <button type="button">
            <SlidersHorizontal size={15} /> Indicators
          </button>
          <button type="button" aria-label="Screenshot">
            <Camera size={15} />
          </button>
          <button type="button" aria-label="Fullscreen">
            <Expand size={15} />
          </button>
        </div>
      </div>
      <div className="chartBody">
        <div className="drawTools" aria-hidden>
          ＋<span>⌁</span>
          <span>⌇</span>
          <span>⌗</span>
          <span>T</span>
          <span>□</span>
          <span>✎</span>
          <span>⌕</span>
          <span>♧</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chartSvg">
          <defs>
            <linearGradient id="zone" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#14d89a" stopOpacity=".22" />
              <stop offset="1" stopColor="#14d89a" stopOpacity=".06" />
            </linearGradient>
          </defs>
          {Array.from({ length: 7 }, (_, i) => (
            <line
              key={`grid-h-${i}`}
              x1={pad.l}
              x2={W - pad.r}
              y1={pad.t + (i * (H - pad.t - pad.b)) / 6}
              y2={pad.t + (i * (H - pad.t - pad.b)) / 6}
              className="grid"
            />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <line
              key={`grid-v-${i}`}
              y1={pad.t}
              y2={H - pad.b}
              x1={pad.l + (i * (W - pad.l - pad.r)) / 7}
              x2={pad.l + (i * (W - pad.l - pad.r)) / 7}
              className="grid"
            />
          ))}
          {channelPaths ? (
            <>
              <path d={channelPaths.upper} className="channel" fill="none" />
              <path d={channelPaths.lower} className="channel" fill="none" />
            </>
          ) : (
            channelPoints && <polygon points={channelPoints} className="channel" />
          )}
          {(() => {
            const y0 = priceToY(levels.supply[0]);
            const y1 = priceToY(levels.supply[1]);
            const x0 = indexToX(Math.floor(n * 0.45));
            const x1 = indexToX(Math.floor(n * 0.78));
            if (y0 === null || y1 === null) return null;
            return (
              <>
                <rect x={x0} y={Math.min(y0, y1)} width={Math.max(1, x1 - x0)} height={Math.max(2, Math.abs(y1 - y0))} className="supply" />
                <text x={indexToX(Math.floor(n * 0.55))} y={y0 + 14} className="supplyText">
                  {tfLabel} Supply
                </text>
              </>
            );
          })()}
          {(() => {
            const y0 = priceToY(levels.erz[0]);
            const y1 = priceToY(levels.erz[1]);
            const x0 = indexToX(Math.floor(n * 0.62));
            const x1 = indexToX(Math.floor(n * 0.92));
            if (y0 === null || y1 === null) return null;
            return (
              <>
                <rect
                  x={x0}
                  y={Math.min(y0, y1)}
                  width={Math.max(1, x1 - x0)}
                  height={Math.max(2, Math.abs(y1 - y0))}
                  fill="url(#zone)"
                  className="erz"
                />
                <text x={indexToX(Math.floor(n * 0.68))} y={Math.min(y0, y1) - 6} className="erzText">
                  {tfLabel} ERZ / Demand
                </text>
              </>
            );
          })()}
          {stSegments
            ? stSegments.map((s, i) => (
                <path
                  key={`st-seg-${i}`}
                  d={s.d}
                  className={s.bull ? 'supertrend bullSt' : 'supertrend bearSt'}
                />
              ))
            : stPath && <path d={stPath} className="supertrend" />}
          {cs.map((c, i) => {
            const yH = priceToY(c.high);
            const yL = priceToY(c.low);
            const yO = priceToY(c.open);
            const yC = priceToY(c.close);
            if (yH === null || yL === null || yO === null || yC === null) return null;
            const bull = c.close >= c.open;
            const yy = Math.min(yO, yC);
            const hh = Math.max(1, Math.abs(yO - yC));
            const xi = indexToX(i);
            return (
              <g key={`candle-${i}-${c.time}`}>
                <line x1={xi} x2={xi} y1={yH} y2={yL} className={bull ? 'wick bull' : 'wick bear'} />
                <rect x={xi - candleW / 2} y={yy} width={candleW} height={hh} className={bull ? 'candle bull' : 'candle bear'} />
                <rect
                  x={xi - candleW / 2}
                  y={H - pad.b - (c.volume / volMax) * 58}
                  width={candleW}
                  height={(c.volume / volMax) * 58}
                  className={bull ? 'volume bull' : 'volume bear'}
                />
              </g>
            );
          })}
          {(() => {
            const yi = priceToY(levels.invalidation);
            if (yi === null) return null;
            return (
              <>
                <line x1={pad.l} x2={W - pad.r} y1={yi} y2={yi} className="invalidLine" />
                <g transform={`translate(${indexToX(n - 3)},${yi - 15})`}>
                  <rect width="120" height="25" rx="2" className="badTag" />
                  <text x="8" y="16" className="tagText">
                    Invalidation {levels.invalidation.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </text>
                </g>
              </>
            );
          })()}
          {(() => {
            const yp = priceToY(levels.p2);
            if (yp === null) return null;
            return (
              <>
                <line x1={indexToX(n - 12)} x2={indexToX(n - 1)} y1={yp} y2={yp} className="p2" />
                <text x={indexToX(n - 4)} y={yp - 7} className="p2Text">
                  P2 Break
                </text>
              </>
            );
          })()}
          {proj && <path d={proj} className="projection" />}
          <Target x={indexToX(n - 4)} y={priceToY(levels.t1)} text={`T1 ${levels.t1.toFixed(2)}`} />
          <Target x={indexToX(n - 2)} y={priceToY(levels.t2)} text={`T2 ${levels.t2.toFixed(2)}`} />
          {placedAnn.map((z) => (
            <g key={`ann-${z.id}-${z.px.toFixed(2)}`} transform={`translate(${z.px},${z.py})`}>
              <circle r={z.label.length < 3 ? 11 : 4} className={`ann ${z.tone}`} />
              <text y={z.label.length < 3 ? 4 : -9} textAnchor="middle" className={`annText ${z.tone}`}>
                {z.label}
              </text>
            </g>
          ))}
          {ticks.map((p, index) => {
            const yt = priceToY(p);
            if (yt === null) return null;
            return (
              <text key={`price-tick-${index}-${p.toFixed(4)}`} x={W - pad.r + 10} y={yt + 4} className="axis">
                {p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </text>
            );
          })}
        </svg>
      </div>
      <div className="chartFoot">
        <div>5Y　1Y　6M　3M　1M　1W　1D</div>
        <div>
          {new Date().toLocaleTimeString()} (UTC+1)　<b>{autonomous ? 'auto' : 'manual'}</b>
        </div>
      </div>
    </div>
  );
}

function Target({ x, y, text }: { x: number; y: number | null; text: string }) {
  if (y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width="88" height="24" rx="2" className="goodTag" />
      <text x="7" y="16" className="tagText">
        {text}
      </text>
    </g>
  );
}
