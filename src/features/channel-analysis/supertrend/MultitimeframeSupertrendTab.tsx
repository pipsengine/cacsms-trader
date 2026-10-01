import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { age, barTime, num } from '../format';
import { fetchSupertrend, resetSupertrendConfig, updateSupertrendConfig } from './supertrendClient';
import { SUPERTREND_TIMEFRAMES, type SupertrendCardSnapshot, type SupertrendSnapshot, type TrendDirection } from './types';
import './supertrend.css';

function signed(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function directionLabel(d: TrendDirection, health: string) {
  if (health === 'INSUFFICIENT_DATA') return 'INSUFFICIENT DATA';
  if (health === 'STALE') return 'STALE';
  if (d === 'UP') return 'UPTREND';
  if (d === 'DOWN') return 'DOWNTREND';
  return 'INSUFFICIENT DATA';
}

function tone(d: TrendDirection, health: string) {
  if (health === 'INSUFFICIENT_DATA') return 'unknown';
  return d === 'UP' ? 'up' : d === 'DOWN' ? 'down' : 'unknown';
}

function SettingsBar({
  data,
  busy,
  onApply,
  onReset,
}: {
  data: SupertrendSnapshot;
  busy: boolean;
  onApply: (m: number, p: number) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [multiplier, setMultiplier] = useState(String(data.settings.atrMultiplier));
  const [period, setPeriod] = useState(String(data.settings.atrPeriod));
  const [error, setError] = useState('');

  useEffect(() => {
    setMultiplier(String(data.settings.atrMultiplier));
    setPeriod(String(data.settings.atrPeriod));
  }, [data.settings.atrMultiplier, data.settings.atrPeriod, data.settings.revision]);

  const apply = async () => {
    const m = Number(multiplier);
    const p = Number(period);
    if (!Number.isFinite(m) || m < 0.1 || m > 10) {
      setError('ATR Multiplier must be between 0.1 and 10.0');
      return;
    }
    if (!Number.isInteger(p) || p < 2 || p > 1000) {
      setError('ATR Period must be an integer between 2 and 1000');
      return;
    }
    setError('');
    await onApply(m, p);
  };

  return (
    <section className="st-settings" aria-label="Supertrend settings">
      <div>
        <span className="st-kicker">Global Supertrend Parameters</span>
        <b>ATR settings apply atomically to all eight contexts</b>
        <small>Version {data.settings.revision} · updated by {data.settings.updatedBy || 'system'}</small>
      </div>
      <label>
        ATR Multiplier
        <input value={multiplier} onChange={(e) => setMultiplier(e.target.value)} inputMode="decimal" disabled={busy} />
      </label>
      <label>
        ATR Period
        <input value={period} onChange={(e) => setPeriod(e.target.value)} inputMode="numeric" disabled={busy} />
      </label>
      <label>
        Confirmation
        <select value="PREVIOUS" disabled>
          <option>Closed Candle</option>
        </select>
      </label>
      <button type="button" onClick={apply} disabled={busy}><SlidersHorizontal size={14} /> Apply</button>
      <button type="button" className="secondary" onClick={onReset} disabled={busy}><RotateCcw size={14} /> Reset Default</button>
      {error && <span className="st-error">{error}</span>}
    </section>
  );
}

function AlignmentBar({ data }: { data: SupertrendSnapshot }) {
  const a = data.alignment;
  return (
    <section className="st-align" aria-label="Multitimeframe Supertrend Alignment">
      <div>
        <span className="st-kicker">Multitimeframe Supertrend Alignment</span>
        <b>{a.bullish}/{a.total} Bullish · {a.bearish}/{a.total} Bearish</b>
      </div>
      <div className="st-align-stats">
        <span>Alignment: <b>{a.alignmentPct.toFixed(1)}%</b></span>
        <span>HTF: <b>{a.htfBias}</b></span>
        <span>Execution: <b>{a.executionBias}</b></span>
        <span>TiT: <b>{a.titState}</b></span>
      </div>
    </section>
  );
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function SupertrendChart({ card }: { card: SupertrendCardSnapshot }) {
  const [ref, W] = useWidth(520);
  const H = 225;
  const pad = { l: 8, r: 56, t: 10, b: 18 };
  const model = useMemo(() => {
    const candles = card.candles;
    if (!candles.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.low, c.supertrend ?? c.low);
      hi = Math.max(hi, c.high, c.supertrend ?? c.high);
    }
    const span = hi - lo || Math.abs(hi) * 0.001 || 1;
    lo -= span * 0.06;
    hi += span * 0.06;
    const step = (W - pad.l - pad.r) / candles.length;
    const x = (i: number) => pad.l + step * (i + 0.5);
    const y = (p: number) => pad.t + ((hi - p) / (hi - lo)) * (H - pad.t - pad.b);
    return { lo, hi, step, x, y };
  }, [card.candles, W]);

  if (!model) return <div className="st-chart-empty">No canonical candles</div>;
  const { lo, hi, step, x, y } = model;
  const bw = Math.max(2, Math.min(8, step * 0.62));
  const points = card.points.filter((p) => p.value != null);
  const segments: { dir: TrendDirection; d: string }[] = [];
  let current: { dir: TrendDirection; parts: string[] } | null = null;
  const idx = new Map(card.candles.map((c, i) => [c.time, i]));
  for (const p of points) {
    const i = idx.get(p.time);
    if (i == null || p.value == null) continue;
    const token: string = `${current?.parts.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    if (!current || current.dir !== p.direction) {
      if (current?.parts.length) segments.push({ dir: current.dir, d: current.parts.join(' ') });
      current = { dir: p.direction, parts: [token.replace(/^L/, 'M')] };
    } else {
      current.parts.push(token);
    }
  }
  if (current?.parts.length) segments.push({ dir: current.dir, d: current.parts.join(' ') });
  const grid = [0.25, 0.5, 0.75].map((f) => lo + (hi - lo) * f);

  return (
    <div className="st-chart-wrap" ref={ref}>
      <svg className="st-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${card.timeframe} Supertrend chart`}>
        <g className="st-grid-lines">
          {grid.map((p) => (
            <g key={p}>
              <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} />
              <text x={W - pad.r + 5} y={y(p) + 3}>{num(p, Math.min(card.digits, 5))}</text>
            </g>
          ))}
        </g>
        {card.candles.map((c, i) => {
          const cls = c.trend === 'UP' ? 'up' : c.trend === 'DOWN' ? 'down' : 'unknown';
          const top = y(Math.max(c.open, c.close));
          const body = Math.max(1, Math.abs(y(c.open) - y(c.close)));
          return (
            <g key={c.time} className={`st-candle ${cls}${c.complete ? '' : ' live'}`}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} />
              <rect x={x(i) - bw / 2} y={top} width={bw} height={body} />
              <title>{`${new Date(c.time).toLocaleString()} O ${num(c.open, card.digits)} H ${num(c.high, card.digits)} L ${num(c.low, card.digits)} C ${num(c.close, card.digits)} · ${c.trend}`}</title>
            </g>
          );
        })}
        {segments.map((s, i) => <path key={i} className={`st-line ${s.dir === 'UP' ? 'up' : s.dir === 'DOWN' ? 'down' : 'unknown'}`} d={s.d} />)}
      </svg>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function SupertrendCard({ card }: { card: SupertrendCardSnapshot }) {
  const cls = tone(card.direction, card.health);
  return (
    <article className="st-card">
      <header>
        <div>
          <span className="st-tf">{card.timeframe}</span>
          <span className={`st-badge ${cls}`}>{directionLabel(card.direction, card.health)}</span>
        </div>
        <small>{card.barCount} bars</small>
      </header>
      <div className="st-health">
        <span>{card.health}</span>
        <span>Closed: {barTime(card.lastClosedCandleTime, card.timeframe === 'D' ? 'D1' : card.timeframe as never)}</span>
      </div>
      <SupertrendChart card={card} />
      <dl className="st-metrics">
        <Metric label="Price" value={num(card.currentPrice, card.digits)} />
        <Metric label="Supertrend" value={num(card.supertrend, card.digits)} />
        <Metric label="ATR" value={num(card.atr, card.digits)} />
        <Metric label="Multiplier" value={card.multiplier.toFixed(2)} />
        <Metric label="ATR Period" value={String(card.atrPeriod)} />
        <Metric label="Distance" value={signed(card.distancePrice, card.digits)} />
        <Metric label="Distance ATR" value={card.distanceAtr == null ? '-' : `${signed(card.distanceAtr, 2)} ATR`} />
        <Metric label="Trend Age" value={card.barsSinceFlip == null ? '-' : `${card.barsSinceFlip} bars`} />
        <Metric label="Last Flip" value={card.lastFlipTime ? new Date(card.lastFlipTime).toLocaleString() : '-'} />
        <Metric label="Freshness" value={card.freshnessMs == null ? '-' : age(card.freshnessMs / 1000)} />
      </dl>
    </article>
  );
}

export function MultitimeframeSupertrendTab({ symbol }: { symbol: string }) {
  const [data, setData] = useState<SupertrendSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async (keep = true) => {
    try {
      const next = await fetchSupertrend(symbol);
      setData(next);
      setError('');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Supertrend unavailable');
      if (!keep) setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let dead = false;
    let timer = 0;
    const run = async () => {
      try {
        const next = await fetchSupertrend(symbol);
        if (!dead) {
          setData(next);
          setError('');
          setLoading(false);
        }
      } catch (exc) {
        if (!dead) {
          setError(exc instanceof Error ? exc.message : 'Supertrend unavailable');
          setLoading(false);
        }
      } finally {
        if (!dead) timer = window.setTimeout(run, 10_000);
      }
    };
    setLoading(true);
    void run();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [symbol]);

  const apply = async (m: number, p: number) => {
    if (!data) return;
    setBusy(true);
    try {
      await updateSupertrendConfig({ atrMultiplier: m, atrPeriod: p, expectedRevision: data.settings.revision });
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await resetSupertrendConfig(data.settings.revision);
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="st-state"><RefreshCw size={18} className="hr-spin" /><b>Loading Multitimeframe Supertrend</b><span>Reading canonical bars from the existing MT5 bridge.</span></div>;
  }
  if (!data) {
    return <div className="st-state error"><AlertTriangle size={18} /><b>Supertrend unavailable</b><span>{error}</span><button type="button" onClick={() => void load(false)}>Retry</button></div>;
  }
  const cards = SUPERTREND_TIMEFRAMES.map((tf) => data.cards?.[tf]).filter((card): card is SupertrendCardSnapshot => Boolean(card));
  const missing = SUPERTREND_TIMEFRAMES.filter((tf) => !data.cards?.[tf]);
  return (
    <div className="st-root">
      {error && <div className="st-banner"><AlertTriangle size={14} /> {error}</div>}
      {missing.length > 0 && (
        <div className="st-banner">
          <AlertTriangle size={14} /> Waiting for {missing.join(', ')} Supertrend contexts from the bridge.
        </div>
      )}
      <SettingsBar data={data} busy={busy} onApply={apply} onReset={reset} />
      <AlignmentBar data={data} />
      {busy && <div className="st-recalc"><RefreshCw size={14} className="hr-spin" /> Recalculating Supertrend...</div>}
      <div className="st-legend">
        <span><i className="up" /> Uptrend regime candles and line</span>
        <span><i className="down" /> Downtrend regime candles and line</span>
        <span><i className="live" /> Open candle is provisional</span>
        <small>Confirmed direction uses the latest closed candle.</small>
      </div>
      {cards.length > 0 ? (
        <section className="st-grid" aria-label={`${symbol} multitimeframe Supertrend cards`}>
          {cards.map((card) => <SupertrendCard key={card.timeframe} card={card} />)}
        </section>
      ) : (
        <div className="st-state"><RefreshCw size={18} className="hr-spin" /><b>Preparing Supertrend contexts</b><span>The bridge is online; waiting for the first complete snapshot.</span></div>
      )}
    </div>
  );
}

