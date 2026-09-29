import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import type { ChannelAnalysisEvent, ChannelDirection, ChannelTimeframe, ChannelUniverseItem, InstrumentChannelState, KeyLevel, StructureInterpretation } from '../types';
import {
  age,
  barTime,
  dirClass,
  GROUP_LABEL,
  human,
  instrumentFlag,
  isoAge,
  isValid,
  num,
  pct,
  REL_LABEL,
  signed,
  statusLabel,
  TIMEFRAMES,
  trendCaption,
} from '../format';

const DIR_ARROW: Record<string, string> = { BULLISH: '↑', BEARISH: '↓', RANGE: '→', UNKNOWN: '·' };

export function TrendMap({ state }: { state: InstrumentChannelState }) {
  return (
    <section className="ca-panel ca-trend" aria-label="Trend-in-trend map">
      <div className="ca-section-title">
        <div>
          <h3>Trend-in-Trend Map</h3>
          <small>Multi-timeframe channel relationship and current market structure</small>
        </div>
      </div>
      <ol className="ca-trend-grid">
        {TIMEFRAMES.map((tf, i) => {
          const c = state.channels[tf];
          const ok = isValid(c);
          const pos = ok ? (c.live?.position ?? c.position) : null;
          return (
            <li key={tf} className="ca-trend-item">
              <div className={`ca-node tf-${tf.toLowerCase()} ${ok ? dirClass(c.direction) : 'none'}`} title={c.relationshipReason || c.reason}>
                <b className="ca-node-tf">{tf}</b>
                <strong aria-hidden="true">{ok ? DIR_ARROW[c.direction] ?? '·' : '∅'}</strong>
                <em>{ok ? c.direction : 'NO CHANNEL'}</em>
                <small className="cap">{ok ? trendCaption(c) : human(c.status)}</small>
                <small>{ok ? `Position ${pct(pos)}` : statusLabel(c)}</small>
              </div>
              {i < TIMEFRAMES.length - 1 && (
                <div className="ca-edge" aria-hidden="true">
                  <span>→</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function opposes(a: ChannelDirection, b: ChannelDirection) {
  return (a === 'BULLISH' && b === 'BEARISH') || (a === 'BEARISH' && b === 'BULLISH');
}

function trendWord(d: ChannelDirection) {
  if (d === 'BULLISH') return 'Bullish';
  if (d === 'BEARISH') return 'Bearish';
  if (d === 'RANGE') return 'Ranging';
  return 'Unresolved';
}

function primaryBlurb(x: StructureInterpretation) {
  if (x.primaryDirection === 'BULLISH') return 'Long-term uptrend intact';
  if (x.primaryDirection === 'BEARISH') return 'Long-term downtrend intact';
  if (x.primaryDirection === 'RANGE') return 'Long-term range intact';
  return 'Primary structure unresolved';
}

function intermediateBlurb(x: StructureInterpretation) {
  if (x.intermediateDirection === 'UNKNOWN') return 'Intermediate structure unresolved';
  if (opposes(x.intermediateDirection, x.primaryDirection)) return 'Corrective phase within primary trend';
  if (x.intermediateDirection === x.primaryDirection) return 'Aligned with the primary trend';
  return 'Rotating inside the primary structure';
}

function currentBlurb(state: InstrumentChannelState) {
  const x = state.interpretation;
  if (x.primaryDirection === 'UNKNOWN' && x.currentTimeframe && x.currentDirection !== 'UNKNOWN') {
    return `${x.currentTimeframe} ${x.currentDirection.toLowerCase()} is the active leg`;
  }
  const leg = state.channels.H1;
  if (leg && isValid(leg) && leg.relationship !== 'PRIMARY' && leg.relationship !== 'UNRESOLVED' && leg.relationship !== 'ALIGNED') {
    const via = (leg.relationshipVia ?? 'H8') as ChannelTimeframe;
    const parent = state.channels[via];
    const move = parent && isValid(parent) ? (parent.direction === 'BULLISH' ? 'up-move' : parent.direction === 'BEARISH' ? 'down-move' : 'range') : 'move';
    return `${leg.timeframe} ${REL_LABEL[leg.relationship].toLowerCase()} within ${via} ${move}`;
  }
  if (x.currentDirection === 'UNKNOWN') return 'Current leg unresolved';
  if (opposes(x.currentDirection, x.primaryDirection)) return 'Short-term pressure against the primary trend';
  return 'Current leg aligned with the higher-timeframe trend';
}

function stateBlurb(x: StructureInterpretation) {
  if (x.primaryDirection === 'UNKNOWN') {
    if (x.marketState === 'CONTINUATION') return 'Continuation on the timeframes with a validated channel';
    return 'Waiting on a validated higher-timeframe channel';
  }
  const trend = trendWord(x.primaryDirection);
  if (x.marketState === 'CORRECTION' || x.marketState === 'COUNTER_CORRECTION' || x.marketState === 'NESTED_CORRECTION') {
    return `${trend} trend with active multi-timeframe correction`;
  }
  if (x.marketState === 'CONTINUATION') return `${trend} trend in continuation across timeframes`;
  if (x.marketState === 'BREAKOUT') return `${trend} structure with a boundary breakout`;
  if (x.marketState === 'REVERSAL_CANDIDATE') return `${trend} trend with a reversal candidate`;
  if (x.marketState === 'CONSOLIDATION') return `${trend} structure consolidating`;
  return 'Structure waiting on a validated channel';
}

function nearest(levels: KeyLevel[], price: number | null, side: 'sup' | 'res') {
  if (price == null) return [];
  const pool = levels.filter((l) => (side === 'sup' ? l.price < price : l.price > price));
  pool.sort((a, b) => (side === 'sup' ? b.price - a.price : a.price - b.price));
  const seen = new Set<string>();
  const out: KeyLevel[] = [];
  for (const level of pool) {
    const key = `${level.timeframe}-${level.price.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(level);
    if (out.length === 2) break;
  }
  return out;
}

export function StructureInterpretationPanel({ state }: { state: InstrumentChannelState }) {
  const x = state.interpretation;
  const d = state.digits;
  const live = state.sourceHealth === 'CONNECTED';
  const supports = nearest(x.keyLevels, state.price, 'sup');
  const resistances = nearest(x.keyLevels, state.price, 'res');
  const levelText = (items: KeyLevel[]) => (items.length ? items.map((l) => `${num(l.price, d)} (${l.timeframe})`).join(' | ') : '—');
  return (
    <section className="ca-panel ca-interpret" aria-label="Overall structure interpretation">
      <div className="ca-section-title">
        <h3>Overall Structure Interpretation</h3>
        <span className={`ca-live${live ? '' : ' warn'}`}>
          <i /> {live ? 'Live Analysis' : human(state.sourceHealth)}
        </span>
      </div>
      <div className="ca-interp-list">
        <div className="ca-interp-row">
          <span className="k">{GROUP_LABEL.primary}</span>
          <b className={`ca-dir-pill ${dirClass(x.primaryDirection)}`}>{x.primaryDirection}</b>
          <span>{primaryBlurb(x)}</span>
        </div>
        <div className="ca-interp-row">
          <span className="k">{GROUP_LABEL.intermediate}</span>
          <b className={`ca-dir-pill ${dirClass(x.intermediateDirection)}`}>{x.intermediateDirection}</b>
          <span>{intermediateBlurb(x)}</span>
        </div>
        <div className="ca-interp-row">
          <span className="k">{GROUP_LABEL.current}</span>
          <b className={`ca-dir-pill ${dirClass(x.currentDirection)}`}>{x.currentDirection}</b>
          <span>{currentBlurb(state)}</span>
        </div>
        <div className="ca-interp-row">
          <span className="k">Market State</span>
          <b className={`ca-dir-pill state ${x.marketState.toLowerCase()}`}>{human(x.marketState).toUpperCase()}</b>
          <span>{stateBlurb(x)}</span>
        </div>
        <div className="ca-interp-row ca-conf-row">
          <span className="k">Structural Confidence</span>
          <span className="ca-conf-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(100, x.structuralConfidence))}%` }} />
          </span>
          <b className="ca-conf-pct">{pct(x.structuralConfidence)}</b>
        </div>
        <div className="ca-interp-row ca-next-levels">
          <span className="k">Next Key Levels</span>
          <span className="ca-level-text">
            Support: <b className="sup">{levelText(supports)}</b>
            <span className="sep"> Resistance: </span>
            <b className="res">{levelText(resistances)}</b>
          </span>
        </div>
      </div>
    </section>
  );
}

export function ChannelSummaryStrip({ state }: { state: InstrumentChannelState }) {
  const valid = TIMEFRAMES.filter((t) => isValid(state.channels[t])).length;
  const forming = TIMEFRAMES.filter((t) => state.channels[t].status === 'FORMING').length;
  const linked = state.hierarchy.filter((e) => e.relationship !== 'UNRESOLVED').length;
  return (
    <div className="ca-summary">
      <div>
        <small>Current price</small>
        <b>{num(state.price, state.digits)}</b>
        <span>{state.priceSource === 'LIVE' ? 'live MT5 tick' : 'last closed H1 candle'}</span>
      </div>
      <div>
        <small>Valid channels</small>
        <b>{valid}/7</b>
        <span>{forming} forming</span>
      </div>
      <div>
        <small>Data freshness</small>
        <b>{age(state.freshnessSeconds)}</b>
        <span className={state.sourceHealth === 'CONNECTED' ? '' : 'warn'}>{human(state.sourceHealth)}</span>
      </div>
      <div>
        <small>Hierarchy</small>
        <b>{linked}/6</b>
        <span>parent-child links</span>
      </div>
    </div>
  );
}

export function InstrumentSelector({
  items,
  value,
  onChange,
}: {
  items: ChannelUniverseItem[];
  value: string;
  onChange: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const options = useMemo(() => {
    const enabled = items.filter((x) => x.enabled);
    return enabled.some((x) => x.symbol === value) || !value
      ? enabled
      : [{ symbol: value, assetClass: 'FX' as const, enabled: true, analysed: false, validChannels: 0, availableTimeframes: [] }, ...enabled];
  }, [items, value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', keys);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  return (
    <div className="ca-instrument" ref={root}>
      <button
        type="button"
        className="ca-instrument-btn"
        aria-label="Select instrument"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ca-flag" aria-hidden="true">
          {instrumentFlag(value)}
        </span>
        <span>{value}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className="ca-instrument-menu" role="listbox" aria-label="Select instrument">
          {options.map((x) => (
            <li key={x.symbol}>
              <button
                type="button"
                role="option"
                aria-selected={x.symbol === value}
                className={x.symbol === value ? 'on' : ''}
                onClick={() => {
                  onChange(x.symbol);
                  setOpen(false);
                }}
              >
                <span className="ca-flag" aria-hidden="true">
                  {instrumentFlag(x.symbol)}
                </span>
                {x.symbol}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChannelMasthead({
  items,
  instrument,
  onInstrument,
  state,
  reanalysing,
  paused,
  canReanalyse,
  onReanalyse,
}: {
  items: ChannelUniverseItem[];
  instrument: string;
  onInstrument: (s: string) => void;
  state: InstrumentChannelState | null;
  reanalysing: boolean;
  paused: boolean;
  canReanalyse: boolean;
  onReanalyse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const valid = state ? TIMEFRAMES.filter((t) => isValid(state.channels[t])).length : null;
  const move = useMemo(() => {
    if (!state || state.price == null) return null;
    const candles = state.channels.H1?.candles;
    const closed = candles?.filter((c) => c.complete !== false) ?? [];
    if (!closed.length) return null;
    const prev = closed[closed.length - 1].close;
    if (!prev) return null;
    const delta = state.price - prev;
    return { delta, pct: (delta / prev) * 100 };
  }, [state]);
  const fresh = state?.sourceHealth === 'CONNECTED';
  return (
    <header className="ca-mast">
      <div className="ca-mast-copy">
        <h1>Channel Analysis</h1>
        <p>Autonomous multi-timeframe channel hierarchy and trend-within-trend intelligence</p>
      </div>
      <div className="ca-mast-stats">
        <InstrumentSelector items={items} value={instrument} onChange={onInstrument} />
        <div className="ca-stat">
          <small>Current Price</small>
          <b>{state ? num(state.price, state.digits) : '—'}</b>
          <span className={move && move.delta < 0 ? 'down' : 'up'}>
            {move && state ? `${signed(move.delta, state.digits)} (${signed(move.pct, 2)}%)` : '—'}
          </span>
        </div>
        <div className="ca-stat">
          <small>Channels Analysed</small>
          <b>{valid == null ? '—' : `${valid}/7`}</b>
          <span>{valid === 7 ? 'All timeframes' : valid == null ? 'Waiting' : `${valid} valid`}</span>
        </div>
        <div className="ca-stat">
          <small>Data Freshness</small>
          <b>{state ? `${age(state.freshnessSeconds)} ago` : '—'}</b>
          <span className={fresh ? 'up' : 'down'}>{state ? (fresh ? 'Live' : human(state.sourceHealth)) : '—'}</span>
        </div>
        <div className="ca-gear-wrap">
          <button type="button" className="ca-gear" aria-label="Channel tools" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Settings size={16} />
          </button>
          {open && (
            <div className="ca-gear-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={reanalysing || !canReanalyse || paused}
                onClick={() => {
                  setOpen(false);
                  onReanalyse();
                }}
              >
                {reanalysing ? 'Queuing…' : 'Re-analyse'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function ChannelLegend() {
  return (
    <div className="ca-legend" aria-hidden="true">
      <span>
        <i className="bull" />
        Bullish
      </span>
      <span>
        <i className="bear" />
        Bearish
      </span>
      <span>
        <i className="range" />
        Range / lean
      </span>
      <span>
        <i />
        No valid channel
      </span>
      <span>Closed candles only · live price moves position, never geometry</span>
    </div>
  );
}

export function EventFeed({ events }: { events: ChannelAnalysisEvent[] }) {
  return (
    <section className="ca-panel ca-feed" aria-label="Channel events">
      <div className="ca-section-title">
        <div>
          <small>EVENT STREAM</small>
          <h3>Structural events</h3>
        </div>
        <span>{events.length} recent</span>
      </div>
      {events.length ? (
        <ul>
          {events.slice(0, 40).map((e) => (
            <li key={e.id} className={`sev-${e.severity.toLowerCase()}`}>
              <b>{e.timeframe}</b>
              <span>
                <em>{human(e.type)}</em> {e.detail}
              </span>
              <small>
                {barTime(e.ts * 1000, e.timeframe)} · {isoAge(e.createdAt)}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ca-muted">No channel events recorded for this instrument yet.</p>
      )}
    </section>
  );
}

export function ChannelAnalysisSkeleton() {
  return (
    <div className="ca-channel-grid ca-skeleton" aria-busy="true" aria-label="Loading channel analysis">
      {TIMEFRAMES.map((tf) => (
        <div className="ca-skel-card" key={tf}>
          <i />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
