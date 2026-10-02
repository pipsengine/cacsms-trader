import React, { useMemo, useState } from 'react';
import {
  Calculator,
  Camera,
  CandlestickChart,
  ChartNoAxesCombined,
  ChevronDown,
  Crosshair,
  Expand,
  GitBranch,
  LockKeyhole,
  Magnet,
  PenLine,
  Square,
  Type,
  ZoomIn,
} from 'lucide-react';
import type { ChartModel, Point } from '../types/chart';
import './TradingChart.css';

const W = 1180;
const H = 665;
const LEFT = 74;
const RIGHT = 82;
const TOP = 82;
const plotW = W - LEFT - RIGHT;
const plotH = H - TOP - 86;

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

function fmt(v: number, digits = 2) {
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export type TradingChartProps = {
  model: ChartModel;
  timeframe?: string;
  onTimeframe?: (tf: string) => void;
  timeframeOptions?: readonly string[];
};

export default function TradingChart({ model, timeframe, onTimeframe, timeframeOptions }: TradingChartProps) {
  const [showIndicators, setShowIndicators] = useState(true);
  const tf = timeframe ?? model.timeframe;

  const allTimes = model.candles.map((c) => c.time);
  const extra = Math.max(...allTimes) + 6 * 3_600_000;
  const tMin = Math.min(...allTimes);
  const tMax = extra;

  const prices = model.candles
    .flatMap((c) => [c.low, c.high])
    .concat(model.levels.map((l) => l.price), model.zones.flatMap((z) => [z.low, z.high]), model.scenario.map((s) => s.price));

  const pMin = Math.floor((Math.min(...prices) - 4) / 10) * 10;
  const pMax = Math.ceil((Math.max(...prices) + 4) / 10) * 10;

  const x = (t: number) => LEFT + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (p: number) => TOP + ((pMax - p) / (pMax - pMin)) * plotH;
  const candleW = Math.max(4, (plotW / (model.candles.length + 8)) * 0.62);

  const ticks = useMemo(() => Array.from({ length: 8 }, (_, i) => pMin + ((pMax - pMin) * i) / 7), [pMin, pMax]);

  const path = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${finite(x(p.time))} ${finite(y(p.price))}`).join(' ');

  const tools = [Crosshair, GitBranch, ChartNoAxesCombined, GitBranch, Square, Type, Square, PenLine, ZoomIn, Magnet, PenLine, LockKeyhole];

  const last = model.candles[model.candles.length - 1]!;
  const prev = model.candles[model.candles.length - 2];
  const change = prev ? last.close - prev.close : 0;
  const changePct = prev && prev.close ? (change / prev.close) * 100 : 0;
  const o = model.ohlc.open;
  const h = model.ohlc.high;
  const l = model.ohlc.low;
  const c = model.ohlc.close;

  const levelStart = (fromTime: number | undefined, tone: string) => {
    if (fromTime != null) return x(fromTime);
    if (tone === 'invalid') return x(model.candles[Math.floor(model.candles.length * 0.32)]!.time);
    if (tone === 'break') return x(model.candles[Math.floor(model.candles.length * 0.58)]!.time);
    return x(model.candles[Math.floor(model.candles.length * 0.68)]!.time);
  };

  const timeLabels = useMemo(() => {
    const picks = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.78, 0.88, 0.95, 1].map((r) =>
      model.candles[Math.min(model.candles.length - 1, Math.floor(r * (model.candles.length - 1)))]!,
    );
    return picks.map((candle) => {
      const d = new Date(candle.time);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    });
  }, [model.candles]);

  return (
    <div className="terminal-card">
      <header className="chart-head">
        <div className="instrument">
          <div className="gold-icon">⌁</div>
          <div>
            <b>{model.symbol}</b>
            <span>{model.name}</span>
          </div>
        </div>
        {onTimeframe && timeframeOptions && timeframeOptions.length > 1 ? (
          <select className="tf tf-select" value={tf} onChange={(e) => onTimeframe(e.target.value)} aria-label="Timeframe">
            {timeframeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className="tf">
            {tf}
            <ChevronDown size={15} />
          </button>
        )}
        <div className="ohlc">
          <span>
            O <b>{fmt(o)}</b>
          </span>
          <span>
            H <b>{fmt(h)}</b>
          </span>
          <span>
            L <b>{fmt(l)}</b>
          </span>
          <span className="close">
            C <b>{fmt(c)}</b>
          </span>
          <span className={change >= 0 ? 'gain' : 'loss'}>
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)} ({changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}%)
          </span>
        </div>
        <div className="head-actions">
          <button type="button">
            <CandlestickChart size={18} />
          </button>
          <button type="button">
            <Calculator size={18} />
          </button>
          <button type="button" className="indicator" onClick={() => setShowIndicators((v) => !v)}>
            <ChartNoAxesCombined size={18} /> Indicators
          </button>
          <button type="button">
            <Camera size={18} />
          </button>
          <button type="button">
            <Expand size={18} />
          </button>
        </div>
      </header>
      <div className="chart-body">
        <aside className="toolrail">
          {tools.map((I, i) => (
            <button key={i} type="button">
              <I size={19} />
            </button>
          ))}
        </aside>
        <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="zoneSupply" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#b63672" stopOpacity=".42" />
              <stop offset="1" stopColor="#5d153b" stopOpacity=".22" />
            </linearGradient>
            <linearGradient id="zoneDemand">
              <stop stopColor="#0f7d5b" stopOpacity=".38" />
              <stop offset="1" stopColor="#073f37" stopOpacity=".22" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect x={LEFT} y={TOP} width={plotW} height={plotH} className="plot-bg" />
          {ticks.map((p, i) => (
            <g key={`gy-${i}`}>
              <line x1={LEFT} x2={LEFT + plotW} y1={y(p)} y2={y(p)} className="grid" />
              <text x={LEFT + plotW + 12} y={y(p) + 4} className="axis-price">
                {fmt(p)}
              </text>
            </g>
          ))}
          {Array.from({ length: 10 }, (_, i) => {
            const xx = LEFT + (plotW * i) / 9;
            return <line key={`gx-${i}`} x1={xx} x2={xx} y1={TOP} y2={TOP + plotH} className="grid" />;
          })}
          {showIndicators && model.channel.upper.length > 0 && (
            <>
              <path d={path(model.channel.upper)} className="channel" />
              <path d={path(model.channel.lower)} className="channel" />
              {model.channel.mid && <path d={path(model.channel.mid)} className="channel mid" />}
            </>
          )}
          {model.zones.map((z) => (
            <g key={z.id}>
              <rect
                x={x(z.from)}
                y={y(z.high)}
                width={Math.max(1, x(z.to) - x(z.from))}
                height={Math.abs(y(z.low) - y(z.high))}
                fill={z.tone === 'supply' ? 'url(#zoneSupply)' : 'url(#zoneDemand)'}
                className={`zone ${z.tone}`}
              />
              <text x={x(z.to) - 12} y={(y(z.high) + y(z.low)) / 2 + 4} textAnchor="end" className="zone-label">
                {z.label}
              </text>
            </g>
          ))}
          {showIndicators &&
            model.supertrend.map((s) => (
              <path key={s.id} d={path(s.points)} className={`supertrend ${s.tone}`} style={{ strokeWidth: s.width || 2 }} />
            ))}
          <g>
            {model.candles.map((c) => {
              const xx = x(c.time);
              const vh = Math.min(72, c.volume * 0.75);
              return (
                <rect
                  key={`v-${c.time}`}
                  x={xx - candleW / 2}
                  y={TOP + plotH - vh}
                  width={candleW}
                  height={vh}
                  className={`volume ${c.close >= c.open ? 'up' : 'down'}`}
                />
              );
            })}
          </g>
          <g>
            {model.candles.map((c) => {
              const xx = x(c.time);
              const up = c.close >= c.open;
              const yo = y(c.open);
              const yc = y(c.close);
              const yh = y(c.high);
              const yl = y(c.low);
              return (
                <g key={`c-${c.time}`}>
                  <line x1={xx} x2={xx} y1={yh} y2={yl} className={`wick ${up ? 'up' : 'down'}`} />
                  <rect
                    x={xx - candleW / 2}
                    y={Math.min(yo, yc)}
                    width={candleW}
                    height={Math.max(1.5, Math.abs(yc - yo))}
                    rx="1"
                    className={`candle ${up ? 'up' : 'down'}`}
                  />
                </g>
              );
            })}
          </g>
          {model.levels.map((l) => {
            const yy = y(l.price);
            if (l.tone === 'price') {
              return (
                <g key={l.id}>
                  <line x1={LEFT} x2={LEFT + plotW} y1={yy} y2={yy} className="current-line" />
                  <rect x={LEFT + plotW} y={yy - 14} width="80" height="28" rx="3" className="price-pill" />
                  <text x={LEFT + plotW + 40} y={yy + 5} textAnchor="middle" className="price-pill-text">
                    {l.label}
                  </text>
                </g>
              );
            }
            const start = levelStart(l.fromTime, l.tone);
            return (
              <g key={l.id}>
                <line x1={start} x2={LEFT + plotW - 6} y1={yy} y2={yy} className={`level-line ${l.tone}`} />
                <rect x={LEFT + plotW - 105} y={yy - 14} width="101" height="28" rx="3" className={`level-pill ${l.tone}`} />
                <text x={LEFT + plotW - 54} y={yy + 4} textAnchor="middle" className={`level-text ${l.tone}`}>
                  {l.label}
                </text>
              </g>
            );
          })}
          {model.scenario.length > 1 && (
            <>
              <path d={path(model.scenario)} className="scenario" filter="url(#glow)" />
              {model.scenario.slice(1).map((p, i) => (
                <path
                  key={`arrow-${i}`}
                  d={`M ${x(p.time) - 7} ${y(p.price) + 8} L ${x(p.time)} ${y(p.price)} L ${x(p.time) + 3} ${y(p.price) + 10}`}
                  className="scenario-arrow"
                />
              ))}
            </>
          )}
          {model.markers.map((m) => {
            const xx = x(m.time);
            const yy = y(m.price);
            if (m.tone === 'number') {
              return (
                <g key={m.id}>
                  <circle cx={xx} cy={yy - 18} r="14" className="number-dot" />
                  <text x={xx} y={yy - 13} textAnchor="middle" className="number-text">
                    {m.number}
                  </text>
                </g>
              );
            }
            return (
              <text key={m.id} x={xx} y={yy} className={`marker ${m.tone}`}>
                {m.label}
              </text>
            );
          })}
          <line x1={LEFT} x2={LEFT + plotW} y1={TOP + plotH} y2={TOP + plotH} className="axis" />
          {timeLabels.map((v, i) => (
            <text key={`${v}-${i}`} x={LEFT + (plotW * i) / (timeLabels.length - 1)} y={TOP + plotH + 27} className="time-label">
              {v}
            </text>
          ))}
        </svg>
      </div>
      <footer className="chart-foot">
        <div className="ranges">
          {['5Y', '1Y', '6M', '3M', '1M', '1W', '1D'].map((r) => (
            <button key={r} type="button">
              {r}
            </button>
          ))}
        </div>
        <div className="foot-right">
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (UTC+1)</span>
          <span>%</span>
          <span>log</span>
          <span className="auto">auto</span>
        </div>
      </footer>
    </div>
  );
}
