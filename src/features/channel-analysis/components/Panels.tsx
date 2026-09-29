import { useMemo, useState } from 'react';
import type { ChannelAnalysisEvent, ChannelUniverseItem, InstrumentChannelState } from '../types';
import {
  age,
  barTime,
  dirArrow,
  dirClass,
  GROUP_LABEL,
  human,
  isoAge,
  isValid,
  num,
  pct,
  REL_LABEL,
  relTone,
  statusLabel,
  TIMEFRAMES,
} from '../format';

export function TrendMap({ state }: { state: InstrumentChannelState }) {
  const valid = TIMEFRAMES.filter((tf) => isValid(state.channels[tf]));
  return (
    <section className="ca-panel ca-trend" aria-label="Trend-in-trend map">
      <div className="ca-section-title">
        <div>
          <small>TREND-IN-TREND MAP</small>
          <h3>Nested channel hierarchy</h3>
        </div>
        <span>
          {valid.length}/7 valid · {state.hierarchy.filter((e) => e.relationship !== 'UNRESOLVED').length} linked
        </span>
      </div>
      <ol className="ca-trend-grid">
        {TIMEFRAMES.map((tf, i) => {
          const c = state.channels[tf];
          const ok = isValid(c);
          const edge = i < TIMEFRAMES.length - 1 ? state.hierarchy[i] : null;
          const next = edge ? state.channels[edge.child] : null;
          return (
            <li key={tf} className="ca-trend-item">
              <div className={`ca-node ${ok ? dirClass(c.direction) : 'none'}`} title={c.relationshipReason || c.reason}>
                <b>{tf}</b>
                <strong aria-hidden="true">{ok ? dirArrow(c.direction) : '∅'}</strong>
                <em>{ok ? c.direction : 'NO CHANNEL'}</em>
                <span className={`ca-rel ${relTone(c.relationship)}`}>{REL_LABEL[c.relationship]}</span>
                <small>{ok ? `${statusLabel(c)} · ${pct(c.confidence)}` : human(c.status)}</small>
                {ok && c.correctionDepth != null && c.correctionDepth > 0 && <small className="depth">depth {c.correctionDepth}</small>}
              </div>
              {edge && next && (
                <div className="ca-edge" aria-hidden="true">
                  <span>→</span>
                  {isValid(next) && edge.via && edge.via !== edge.parent && <small>via {edge.via}</small>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="ca-chain">
        {valid.length ? (
          valid.map((tf, i) => {
            const c = state.channels[tf];
            return (
              <span key={tf} className={`ca-chain-step ${dirClass(c.direction)}`} style={{ marginLeft: `${Math.min(4, c.correctionDepth ?? 0) * 14}px` }}>
                {i > 0 && <i aria-hidden="true">└</i>}
                <b>{tf}</b> {c.direction.toLowerCase()} — {REL_LABEL[c.relationship].toLowerCase()}
                {c.relationshipVia && c.relationship !== 'PRIMARY' ? ` of ${c.relationshipVia}` : ''}
              </span>
            );
          })
        ) : (
          <span className="ca-muted">No timeframe has a validated channel — the hierarchy is empty until one validates.</span>
        )}
      </div>
    </section>
  );
}

export function StructureInterpretationPanel({ state }: { state: InstrumentChannelState }) {
  const x = state.interpretation;
  const d = state.digits;
  const levels = [...x.keyLevels].sort((a, b) => b.price - a.price);
  return (
    <section className="ca-panel ca-interpret" aria-label="Overall structure interpretation">
      <div className="ca-section-title">
        <div>
          <small>STRUCTURAL SYNTHESIS</small>
          <h3>Overall structure interpretation</h3>
        </div>
        <span className={`ca-state ${x.marketState.toLowerCase()}`}>{human(x.marketState)}</span>
      </div>
      <dl>
        <div>
          <dt>{GROUP_LABEL.primary}</dt>
          <dd className={dirClass(x.primaryDirection)}>
            {dirArrow(x.primaryDirection)} <b>{x.primaryDirection}</b>
          </dd>
        </div>
        <div>
          <dt>{GROUP_LABEL.intermediate}</dt>
          <dd className={dirClass(x.intermediateDirection)}>
            {dirArrow(x.intermediateDirection)} <b>{x.intermediateDirection}</b>
          </dd>
        </div>
        <div>
          <dt>{GROUP_LABEL.current}</dt>
          <dd className={dirClass(x.currentDirection)}>
            {dirArrow(x.currentDirection)} <b>{x.currentDirection}</b>
          </dd>
        </div>
        <div>
          <dt>Parent direction</dt>
          <dd className={dirClass(x.parentDirection)}>
            <b>{x.parentDirection}</b> {x.parentTimeframe ? `(${x.parentTimeframe})` : ''}
          </dd>
        </div>
        <div>
          <dt>Current leg</dt>
          <dd className={dirClass(x.currentLegDirection)}>
            <b>{x.currentLegDirection}</b> {x.currentTimeframe ? `(${x.currentTimeframe})` : ''}
          </dd>
        </div>
        <div>
          <dt>Correction depth</dt>
          <dd>
            {human(x.correctionDepth)}
            {x.correctionRetracement != null ? ` · ${pct(x.correctionRetracement, 1)} of parent width` : ''}
          </dd>
        </div>
        <div>
          <dt>Alignment</dt>
          <dd>{pct(x.alignmentScore)}</dd>
        </div>
        <div>
          <dt>Structural confidence</dt>
          <dd>
            <progress max={100} value={x.structuralConfidence} aria-label="Structural confidence" />
            {pct(x.structuralConfidence)}
          </dd>
        </div>
      </dl>
      <p>{x.narrative}</p>
      <h4 className="ca-sub">Key levels</h4>
      {levels.length ? (
        <ul className="ca-levels">
          {levels.map((l) => (
            <li key={`${l.timeframe}-${l.kind}`} className={l.price >= (state.price ?? 0) ? 'res' : 'sup'}>
              <span>
                {l.timeframe} {l.kind.toLowerCase()}
              </span>
              <b>{num(l.price, d)}</b>
              <small>{l.distanceAtr == null ? '—' : `${l.distanceAtr > 0 ? '+' : ''}${l.distanceAtr.toFixed(2)} ATR`}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ca-muted">No key levels — no valid channel.</p>
      )}
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
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const f = items.filter((x) => x.enabled && x.symbol.includes(q.trim().toUpperCase()));
    return f.some((x) => x.symbol === value) ? f : [...items.filter((x) => x.symbol === value), ...f];
  }, [items, q, value]);
  return (
    <div className="ca-selector">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter instruments" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Select instrument">
        {filtered.map((x) => (
          <option key={x.symbol} value={x.symbol}>
            {x.symbol} {x.analysed ? `· ${x.validChannels}/7 valid` : '· analysing'}
          </option>
        ))}
      </select>
    </div>
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
    <div className="ca-skeleton" aria-busy="true" aria-label="Loading channel analysis">
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
