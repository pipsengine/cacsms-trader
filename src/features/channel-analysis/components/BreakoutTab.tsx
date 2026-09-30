import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchBreakoutCandidate,
  fetchBreakoutState,
  fetchChannelLive,
  type BreakoutCandidate,
  type BreakoutChart,
  type BreakoutState,
  type ChannelLiveBar,
  type ChannelLiveQuote,
} from '../services/channelClient';
import { CandidateEmailStatus } from '../../notifications/EmailNotificationsPanel';

const FILTERS = [
  ['ALL', 'All'],
  ['NEAR_BREAKOUT', 'Near Break'],
  ['BREAK_DETECTED', 'Break Detected'],
  ['BREAK_CONFIRMED', 'Confirmed'],
  ['RETESTING', 'Retesting'],
  ['RETEST_HELD', 'Retest Held'],
] as const;

const LEVELS = ['ALL', 'L1', 'L2', 'L3', 'L4'] as const;

const SEQUENCE = [
  ['CHANNEL_ACTIVE', 'Channel active'],
  ['NEAR_BREAKOUT', 'Near breakout'],
  ['BREAK_DETECTED', 'Break detected'],
  ['BREAK_CONFIRMED', 'Break confirmed'],
  ['RETEST', 'Retest'],
  ['CONTINUATION', 'Continuation'],
] as const;

function label(state?: string) {
  return (state || '—').replace(/_/g, ' ');
}

function n(value: number | null | undefined, digits = 2) {
  return value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits);
}

function sequenceMark(state: string | undefined, step: string): 'done' | 'current' | 'wait' | 'failed' {
  const order = ['NEAR_BREAKOUT', 'BREAK_DETECTED', 'BREAK_CONFIRMED', 'RETESTING', 'RETEST_HELD'];
  const at = order.indexOf(state || '');
  const idx = step === 'CHANNEL_ACTIVE' ? -1 : step === 'NEAR_BREAKOUT' ? 0 : step === 'BREAK_DETECTED' ? 1 : step === 'BREAK_CONFIRMED' ? 2 : step === 'RETEST' ? 3 : 5;
  if (state === 'FAILED_BREAKOUT') return idx <= 2 ? 'failed' : 'wait';
  if (step === 'CHANNEL_ACTIVE') return at >= 0 ? 'done' : 'current';
  if (step === 'RETEST') {
    if (state === 'RETEST_HELD') return 'done';
    if (state === 'RETESTING') return 'current';
    return 'wait';
  }
  if (step === 'CONTINUATION') return 'wait';
  if (at === idx) return 'current';
  if (at > idx) return 'done';
  return 'wait';
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function priceDigits(price: number) {
  const size = Math.abs(price);
  return size >= 1000 ? 2 : size >= 20 ? 3 : 5;
}

function axisTime(ms: number, tf?: string) {
  const d = new Date(ms);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  if (tf === 'M15' || tf === 'M5' || tf === 'H1') {
    return `${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (tf === 'Y' || tf === 'Q' || tf === 'MN') return `${mon} ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${mon}`;
}

function paintLive(chart: BreakoutChart | null, live: ChannelLiveQuote | null, tf?: string, symbol?: string): BreakoutChart | null {
  if (!chart || !live || !tf || live.instrument !== symbol) return chart;
  const bar = (live.bars as Record<string, ChannelLiveBar | undefined> | undefined)?.[tf];
  if (!bar) return chart;
  const candles = (chart.candles || []).slice();
  const candle = { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  if (!candles.length || candles[candles.length - 1].time < bar.time) candles.push(candle);
  else if (candles[candles.length - 1].time === bar.time) candles[candles.length - 1] = candle;
  let lines = chart.lines || [];
  if (bar.line) {
    lines = lines.filter((line) => line.time !== bar.line!.time);
    lines = [...lines, bar.line];
  }
  return { ...chart, candles, lines };
}

function BreakChart({
  chart,
  price,
  boundary,
  breakAt,
  direction,
  timeframe,
}: {
  chart: BreakoutChart | null;
  price?: number | null;
  boundary?: string;
  breakAt?: number | null;
  direction?: string;
  timeframe?: string;
}) {
  const [wrapRef, width] = useWidth(960);
  const candles = chart?.candles || [];
  if (!candles.length) {
    return <div className="ca-pending">Chart loads from the selected candidate's closed candles.</div>;
  }
  const height = 420;
  const pad = { l: 8, r: 72, t: 16, b: 22 };
  const lines = chart?.lines || [];
  const idx = new Map(candles.map((candle, i) => [candle.time, i]));
  const pts = lines.filter((line) => idx.has(line.time));
  let lo = Math.min(...candles.map((candle) => candle.low));
  let hi = Math.max(...candles.map((candle) => candle.high));
  for (const line of pts) {
    lo = Math.min(lo, line.lower);
    hi = Math.max(hi, line.upper);
  }
  if (price != null) {
    lo = Math.min(lo, price);
    hi = Math.max(hi, price);
  }
  const span = hi - lo || Math.abs(hi) * 0.001 || 1;
  lo -= span * 0.06;
  hi += span * 0.06;
  const step = (width - pad.l - pad.r) / Math.max(1, candles.length);
  const x = (i: number) => pad.l + step * (i + 0.5);
  const y = (p: number) => pad.t + ((hi - p) / (hi - lo)) * (height - pad.t - pad.b);
  const at = (line: (typeof pts)[number]) => x(idx.get(line.time)!);
  const path = (key: 'upper' | 'lower' | 'mid') => pts.map((line, i) => `${i ? 'L' : 'M'}${at(line).toFixed(1)},${y(line[key]).toFixed(1)}`).join(' ');
  const band = pts.length > 1
    ? `${path('upper')} ${[...pts].reverse().map((line) => `L${at(line).toFixed(1)},${y(line.lower).toFixed(1)}`).join(' ')} Z`
    : '';
  const side = boundary === 'LOWER' ? 'lower' : 'upper';
  const zoneHalf = chart?.retest?.zoneHigh != null && chart.retest.zoneLow != null
    ? Math.abs(chart.retest.zoneHigh - chart.retest.zoneLow) / 2
    : 0;
  const zonePts = zoneHalf > 0 ? pts.filter((line) => breakAt == null || line.time >= breakAt) : [];
  const zone = zonePts.length > 1
    ? `M${zonePts.map((line) => `${at(line).toFixed(1)},${y(line[side] + zoneHalf).toFixed(1)}`).join(' L')} ${[...zonePts].reverse().map((line) => `L${at(line).toFixed(1)},${y(line[side] - zoneHalf).toFixed(1)}`).join(' ')} Z`
    : '';
  const breakIndex = breakAt == null ? -1 : candles.findIndex((candle) => candle.time >= breakAt);
  const bw = Math.max(1.2, Math.min(8, step * 0.62));
  const digits = priceDigits(price ?? candles[candles.length - 1].close);
  const grid = [0.25, 0.5, 0.75].map((f) => lo + (hi - lo) * f);
  const timeIdx = [0, Math.floor((candles.length - 1) / 2), candles.length - 1];
  const tone = direction === 'BEARISH' ? 'dir-bearish' : 'dir-bullish';
  return (
    <div className={`cb-chart-wrap ${tone}`} ref={wrapRef}>
      <svg className="ca-chart detail" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Channel breakout chart">
        <g className="ca-grid">
          {grid.map((level) => (
            <g key={level}>
              <line x1={pad.l} x2={width - pad.r} y1={y(level)} y2={y(level)} />
              <text x={width - pad.r + 6} y={y(level) + 3}>{n(level, digits)}</text>
            </g>
          ))}
        </g>
        {band && <path className="band" d={band} />}
        {zone && <path className="retest-zone" d={zone} />}
        {candles.map((candle, i) => {
          const up = candle.close >= candle.open;
          const top = y(Math.max(candle.open, candle.close));
          const body = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
          return (
            <g key={candle.time} className={up ? 'up' : 'down'}>
              <line x1={x(i)} x2={x(i)} y1={y(candle.high)} y2={y(candle.low)} />
              <rect x={x(i) - bw / 2} y={top} width={bw} height={body} />
            </g>
          );
        })}
        {pts.length > 1 && (
          <>
            <path className={side === 'upper' ? 'boundary dim' : 'boundary focus'} d={path('lower')} fill="none" />
            <path className={side === 'lower' ? 'boundary dim' : 'boundary focus'} d={path('upper')} fill="none" />
            <path className="mid" d={path('mid')} fill="none" />
          </>
        )}
        {breakIndex >= 0 && <line className="breakout" x1={x(breakIndex)} x2={x(breakIndex)} y1={pad.t} y2={height - pad.b} />}
        {price != null && (
          <>
            <line className="price" x1={pad.l} x2={width - pad.r} y1={y(price)} y2={y(price)} />
            <text className="price-label" x={width - pad.r + 6} y={y(price) + 3}>{n(price, digits)}</text>
          </>
        )}
        <g className="ca-axis">
          {timeIdx.map((i) => (
            <text key={candles[i].time} x={x(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === candles.length - 1 ? 'end' : 'middle'}>
              {axisTime(candles[i].time, timeframe)}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}

export function BreakoutTab({ state, onRefresh }: { state: BreakoutState | null; onRefresh: () => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('ALL');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('ALL');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chart, setChart] = useState<BreakoutChart | null>(null);
  const [live, setLive] = useState<ChannelLiveQuote | null>(null);
  const candidates = state?.candidates || [];
  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    return candidates.filter((row) => {
      const st = row.breakout?.state;
      if (filter !== 'ALL' && st !== filter) return false;
      if (level !== 'ALL' && row.titLevel !== level) return false;
      if (q && !`${row.symbol} ${row.titLevel} ${row.channel?.timeframe || ''}`.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [candidates, filter, level, query]);
  const selected = visible.find((row) => row.candidateId === selectedId) || visible[0] || null;

  useEffect(() => {
    if (!selected) {
      setChart(null);
      return;
    }
    let cancel = false;
    void fetchBreakoutCandidate(selected.candidateId)
      .then((row) => {
        if (!cancel) setChart(row.chart);
      })
      .catch(() => {
        if (!cancel) setChart(null);
      });
    return () => {
      cancel = true;
    };
  }, [selected?.candidateId]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(() => {
      void fetchBreakoutCandidate(selected.candidateId)
        .then((row) => setChart(row.chart))
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [selected?.candidateId]);

  useEffect(() => {
    if (!selected) {
      setLive(null);
      return;
    }
    let cancel = false;
    const pull = () => {
      void fetchChannelLive(selected.symbol)
        .then((row) => {
          if (!cancel) setLive(row);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 1000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [selected?.symbol]);

  const painted = useMemo(
    () => paintLive(chart, live, selected?.channel?.timeframe, selected?.symbol),
    [chart, live, selected?.channel?.timeframe, selected?.symbol],
  );

  const counts = state?.counts || {};
  return (
    <div className="cb-tab">
      <header className="cb-head">
        <div>
          <h2>Channel Breakout & Retest</h2>
          <p>Autonomous detection, confirmation and retest monitoring across the 29-instrument universe.</p>
        </div>
        <div className="cb-counters">
          <span>{state?.instrumentsScanned ?? 0}/{state?.universe ?? 29} scanned</span>
          <span>Near break {counts.NEAR_BREAKOUT ?? 0}</span>
          <span>Break detected {counts.BREAK_DETECTED ?? 0}</span>
          <span>Confirmed {counts.BREAK_CONFIRMED ?? 0}</span>
          <span>Retesting {(counts.RETESTING ?? 0) + (counts.RETEST_HELD ?? 0)}</span>
          <span className={state?.health === 'HEALTHY' ? 'ok' : 'warn'}>{state?.health || 'STARTING'}</span>
          <button type="button" onClick={onRefresh}>Refresh</button>
        </div>
      </header>

      {!candidates.length ? (
        <section className="ca-panel ca-pending" role="status">
          <b>No active channel breakout watches</b>
          <span>{state?.instrumentsScanned ?? 0} instruments scanned · 0 near breakout · 0 break detected · 0 break confirmed · 0 retesting. Scanning continues on the bridge.</span>
        </section>
      ) : (
        <>
          <div className="cb-tools">
            <label>
              Active watches
              <select value={selected?.candidateId || ''} onChange={(e) => setSelectedId(e.target.value)}>
                {visible.map((row) => (
                  <option key={row.candidateId} value={row.candidateId}>
                    {row.symbol} · {row.channel?.timeframe} · {row.titLevel} · {label(row.breakout?.state)}
                    {row.breakout?.distanceATR != null ? ` · ${n(row.breakout.distanceATR, 2)} ATR` : ''} · {row.breakout?.relevantBoundary}
                  </option>
                ))}
              </select>
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search active watches" aria-label="Search active breakout watches" />
            <div className="cb-filters">
              {FILTERS.map(([id, text]) => (
                <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{text}</button>
              ))}
              {LEVELS.map((id) => (
                <button key={id} type="button" className={level === id ? 'on' : ''} onClick={() => setLevel(id)}>{id === 'ALL' ? 'All levels' : id}</button>
              ))}
            </div>
          </div>
          {!selected ? (
            <div className="ca-pending">No watch matches this filter.</div>
          ) : (
            <Selected row={selected} chart={painted} live={live} />
          )}
        </>
      )}
      <History rows={state?.history || []} />
    </div>
  );
}

function Selected({ row, chart, live }: { row: BreakoutCandidate; chart: BreakoutChart | null; live: ChannelLiveQuote | null }) {
  const b = row.breakout || {};
  const ch = row.channel || {};
  const view = live?.instrument === row.symbol
    ? (live.views as Record<string, { position?: number | null; distanceUpperAtr?: number | null; distanceLowerAtr?: number | null; liveUpper?: number; liveLower?: number } | undefined> | undefined)?.[ch.timeframe || '']
    : undefined;
  const price = live?.instrument === row.symbol && live.price != null ? live.price : b.currentPrice;
  const position = view?.position ?? ch.position;
  const boundaryPrice = b.relevantBoundary === 'LOWER' ? (view?.liveLower ?? b.boundaryPrice) : (view?.liveUpper ?? b.boundaryPrice);
  const distanceAtr = b.relevantBoundary === 'LOWER' ? (view?.distanceLowerAtr ?? b.distanceATR) : (view?.distanceUpperAtr ?? b.distanceATR);
  const distancePrice = price != null && boundaryPrice != null
    ? (b.relevantBoundary === 'LOWER' ? price - boundaryPrice : boundaryPrice - price)
    : b.distancePrice;
  const digits = price != null ? priceDigits(price) : 5;
  const tick = live?.instrument === row.symbol && live.ageSec != null ? ` · tick ${live.ageSec}s` : '';
  return (
    <div className="cb-body">
      <section className="ca-panel cb-summary">
        <h3>{row.symbol}</h3>
        <dl>
          <div><dt>TiT</dt><dd>{row.titLevel}</dd></div>
          <div><dt>Family</dt><dd>{label(row.opportunityFamily)}</dd></div>
          <div><dt>Channel</dt><dd>{ch.timeframe} · {label(row.channelRole)}</dd></div>
          <div><dt>Parent</dt><dd>{row.parent?.timeframe} {row.parent?.direction}</dd></div>
          <div><dt>Child</dt><dd>{ch.direction}</dd></div>
          <div><dt>Price</dt><dd>{n(price, digits)}</dd></div>
          <div><dt>Position</dt><dd>{n(position, 1)}%</dd></div>
          <div><dt>Boundary</dt><dd>{b.relevantBoundary} {n(boundaryPrice, digits)}</dd></div>
          <div><dt>Distance</dt><dd>{n(distancePrice, digits)} · {n(distanceAtr, 2)} ATR</dd></div>
          <div><dt>Expected break</dt><dd>{b.expectedDirection}</dd></div>
          <div><dt>Confidence</dt><dd>{n(ch.confidence, 0)}</dd></div>
          <div><dt>Channel status</dt><dd>{ch.status}</dd></div>
          <div><dt>Break state</dt><dd>{label(b.state)}</dd></div>
          <div><dt>Freshness</dt><dd>{row.freshness?.state}{tick}</dd></div>
        </dl>
        <p className="ca-muted">Watching is not authorization. P1 and P2 still pass through confirmation and Stage 8.</p>
      </section>
      <section className="ca-panel cb-chart-panel">
        <BreakChart
          chart={chart}
          price={price}
          boundary={b.relevantBoundary}
          breakAt={b.confirmedAt || b.detectedAt}
          direction={b.expectedDirection}
          timeframe={ch.timeframe}
        />
      </section>
      <ol className="cb-sequence">
        {SEQUENCE.map(([id, text]) => {
          const mark = sequenceMark(b.state, id);
          return <li key={id} className={mark}><b>{text}</b><span>{mark}</span></li>;
        })}
      </ol>
      <div className="cb-panels">
        <Panel title="P1 — reaction entry" state={row.p1?.state} reason={row.p1?.reason} note="Price inside the retracement zone is not a ready leg." />
        <Panel title="P2 — continuation / breakout" state={row.p2?.state} reason={row.p2?.reason} note="A channel break is not a BOS and is not P2 ready." />
        <article className="ca-panel">
          <h3>Channel break</h3>
          <p>{b.expectedDirection} · {b.relevantBoundary} · close {n(b.breakPrice, 5)}</p>
          <p>Detected {b.detectedAt ? new Date(b.detectedAt).toISOString() : '—'} · Confirmed {b.confirmedAt ? new Date(b.confirmedAt).toISOString() : '—'}</p>
          <p>Penetration {n(b.penetrationAtr, 2)} ATR · quality {n(b.quality, 2)} · engine {label(b.engineState)}</p>
        </article>
        <article className="ca-panel">
          <h3>Retest</h3>
          <p>{label(row.retest?.state || 'WAITING')}</p>
          <p>Zone {n(row.retest?.zoneLow, 5)} – {n(row.retest?.zoneHigh, 5)}</p>
          <p>Confirmation {row.confirmationTimeframe} · {row.retest?.failureReason || 'no failure'}</p>
        </article>
        <CandidateEmailStatus candidateId={row.candidateId} />
        <article className="ca-panel">
          <h3>BOS / CHoCH</h3>
          <p>BOS {row.structure?.bos?.label || 'none on this channel'}</p>
          <p>CHoCH {row.structure?.choch?.label || 'none on this channel'}</p>
          <p className="ca-muted">These structural events stay separate from the channel break.</p>
        </article>
      </div>
    </div>
  );
}

function Panel({ title, state, reason, note }: { title: string; state?: string | null; reason?: string | null; note: string }) {
  return (
    <article className="ca-panel">
      <h3>{title}</h3>
      <b>{label(state || 'NOT_IN_CAMPAIGN')}</b>
      <p>{reason || note}</p>
      <p className="ca-muted">{note}</p>
    </article>
  );
}

function History({ rows }: { rows: BreakoutCandidate[] }) {
  if (!rows.length) return null;
  return (
    <section className="ca-panel cb-history">
      <h3>Recent breakout audit</h3>
      <ul>
        {rows.slice(0, 12).map((row, index) => (
          <li key={`${row.candidateId}-${row.breakout?.state}-${row.removedReason || ''}-${row.removedAt ?? index}`}>
            {row.symbol} {row.titLevel} {row.channel?.timeframe} · {label(row.breakout?.state)}
            {row.removedReason ? ` · ${label(row.removedReason)}` : ''}
            {row.retest?.failureReason ? ` · ${label(row.retest.failureReason)}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function useBreakoutWatch() {
  const [state, setState] = useState<BreakoutState | null>(null);
  const load = () => {
    void fetchBreakoutState().then(setState).catch(() => setState((prev) => prev));
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return { state, load };
}
