import { Fragment, useMemo, useState } from 'react';
import type { InstrumentTrace, PipelineState, TraceDecision, TraceField } from '../types/workflow';
import { DecisionBadge, FreshTag, StateChip } from './chips';
import { age, human, stamp } from '../utils/format';

type SortKey = 'symbol' | 'gate' | 'passed' | 'state' | 'confidence' | 'decision' | 'age';

const DECISIONS: (TraceDecision | 'ALL')[] = ['ALL', 'WAIT', 'READY', 'BLOCKED', 'OPEN', 'REJECTED', 'INVALIDATED'];
const STATES: (PipelineState | 'ALL')[] = ['ALL', 'RUNNING', 'READY', 'WAITING', 'WARMING_UP', 'BLOCKED', 'STALE', 'INVALIDATED', 'PAUSED'];
const DECISION_RANK: Record<TraceDecision, number> = { OPEN: 0, READY: 1, WAIT: 2, REJECTED: 3, INVALIDATED: 4, BLOCKED: 5 };

function Field({ f, className = '' }: { f: TraceField; className?: string }) {
  return (
    <td className={`ev ${f.freshness.toLowerCase()} ${className}`} title={`${f.source} · ${f.detail}${f.at ? ` · ${stamp(f.at)}` : ''}`}>
      <span>{f.value}</span>
      <FreshTag f={f.freshness} />
    </td>
  );
}

function Progress({ t }: { t: InstrumentTrace }) {
  return (
    <span className="progress" title={`${t.stagesPassed} of 10 gates passed on the live path · analysis reached S${t.analysisDepth || '—'}`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < t.stagesPassed ? 'on' : i === t.currentGate - 1 ? `cur ${t.state.toLowerCase()}` : i < t.analysisDepth ? 'known' : ''} />
      ))}
    </span>
  );
}

const MINI: [keyof Pick<InstrumentTrace, 'macro' | 'regime' | 'd1' | 'h8' | 'h1' | 'risk'>, string, string][] = [
  ['macro', 'M', 'Macro'],
  ['regime', 'Rg', 'Regime'],
  ['d1', 'D1', 'D1 channel'],
  ['h8', 'H8', 'H8 channel'],
  ['h1', 'H1', 'H1 confirmation'],
  ['risk', 'Rk', 'Risk'],
];

function EvidenceMini({ t }: { t: InstrumentTrace }) {
  return (
    <span className="ev-mini">
      {MINI.map(([k, short, label]) => {
        const f = t[k];
        return (
          <i key={k} className={f.freshness.toLowerCase()} title={`${label}: ${f.value} · ${f.freshness === 'LAST_KNOWN' ? 'LAST KNOWN' : f.freshness} · ${f.source}`}>
            {short}
          </i>
        );
      })}
    </span>
  );
}

function Detail({ t, busy, onReevaluate }: { t: InstrumentTrace; busy: string | null; onReevaluate: (s?: string) => void }) {
  const fields: [string, TraceField][] = [
    ['Macro strength', t.macro],
    ['Regime', t.regime],
    ['D1 channel', t.d1],
    ['H8 channel', t.h8],
    ['H1 confirmation', t.h1],
    ['Risk', t.risk],
  ];
  return (
    <div className="trace-detail">
      <div>
        <h4>Live path</h4>
        <p>
          Held at <b>S{t.currentGate} · {t.gateName}</b> ({human(t.state)}) · {t.stagesPassed} gate(s) passed · analysis reached S{t.analysisDepth || '—'}
        </p>
        <p className="detail-decision">
          <DecisionBadge d={t.decision} /> <StateChip state={t.state} /> {t.direction === 'NEUTRAL' ? '' : <b className={`dir ${t.direction.toLowerCase()}`}>{t.direction}</b>} · confidence{' '}
          <b>{t.confidence == null ? '—' : `${t.confidence}%`}</b>
          {t.confidenceSource && <small> from {t.confidenceSource}</small>}
        </p>
        <p>
          <b>Blocker:</b> {t.blocker || 'none'}
        </p>
        <p>
          <b>Waiting for:</b> {t.waitingFor || '—'}
        </p>
        <p>
          <b>Next action:</b> {t.nextAction || '—'}
        </p>
        <button type="button" className="mini" disabled={Boolean(busy)} onClick={() => onReevaluate(t.symbol)} title="Requests Stage 5→8 processing for this instrument on the bridge">
          Re-evaluate {t.symbol}
        </button>
      </div>
      <div className="trace-fields">
        {fields.map(([label, f]) => (
          <div key={label} className={`ev ${f.freshness.toLowerCase()}`}>
            <span>
              {label} <small>{f.source}</small>
            </span>
            <b>
              {f.value} <FreshTag f={f.freshness} />
            </b>
            <small>{f.detail}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

type TraceProps = { rows: InstrumentTrace[]; busy: string | null; onReevaluate: (s?: string) => void; expanded: string | null; onExpand: (s: string | null) => void };

export function InstrumentTraceTable({ rows, busy, onReevaluate, expanded, onExpand }: TraceProps) {
  const [q, setQ] = useState('');
  const [decision, setDecision] = useState<TraceDecision | 'ALL'>('ALL');
  const [state, setState] = useState<PipelineState | 'ALL'>('ALL');
  const [gate, setGate] = useState(0);
  const [liveOnly, setLiveOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'gate', dir: -1 });

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const out = rows.filter(
      (r) =>
        (!needle || r.symbol.includes(needle) || r.blocker.toUpperCase().includes(needle)) &&
        (decision === 'ALL' || r.decision === decision) &&
        (state === 'ALL' || r.state === state) &&
        (!gate || r.currentGate === gate) &&
        (!liveOnly || r.liveEligible),
    );
    const val = (r: InstrumentTrace): number | string => {
      switch (sort.key) {
        case 'symbol':
          return r.symbol;
        case 'gate':
          return r.currentGate * 100 + r.analysisDepth;
        case 'passed':
          return r.stagesPassed;
        case 'state':
          return r.state;
        case 'confidence':
          return r.confidence ?? -1;
        case 'decision':
          return DECISION_RANK[r.decision];
        case 'age':
          return r.ageSec ?? -1;
      }
    };
    return out.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.symbol.localeCompare(b.symbol)) * sort.dir;
    });
  }, [rows, q, decision, state, gate, liveOnly, sort]);

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <section className="panel">
      <div className="panel-title wrap-title">
        <div>
          <span className="eyebrow">{rows.length}-INSTRUMENT DECISION TRACE</span>
          <h2>Instrument Workflow Trace</h2>
        </div>
        <div className="filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol or blocker" aria-label="Search instruments" />
          <select value={decision} onChange={(e) => setDecision(e.target.value as TraceDecision | 'ALL')} aria-label="Decision filter">
            {DECISIONS.map((x) => (
              <option key={x} value={x}>
                {x === 'ALL' ? 'All decisions' : x}
              </option>
            ))}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value as PipelineState | 'ALL')} aria-label="State filter">
            {STATES.map((x) => (
              <option key={x} value={x}>
                {x === 'ALL' ? 'All states' : human(x)}
              </option>
            ))}
          </select>
          <select value={gate} onChange={(e) => setGate(Number(e.target.value))} aria-label="Gate filter">
            <option value={0}>All gates</option>
            {Array.from({ length: 9 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Held at S{i + 1}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} /> Live-eligible only
          </label>
          <button type="button" onClick={() => onReevaluate()} disabled={Boolean(busy)} title="Requests Stage 4→8 processing on the bridge; no gate is bypassed">
            Re-evaluate all
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="wf-table trace">
          <thead>
            <tr>
              {th('symbol', 'Instrument', 'w-sym')}
              {th('gate', 'Current gate', 'w-gate')}
              {th('passed', 'Progress', 'p4 w-prog')}
              {th('state', 'State', 'w-state')}
              <th className="p3 w-dir">Dir.</th>
              {th('confidence', 'Conf.', 'pm w-conf')}
              {th('decision', 'Decision', 'pm w-dec')}
              <th className="blocker">Primary blocker / waiting for</th>
              <th className="p2 w-mini" title="Macro · Regime · D1 · H8 · H1 · Risk — green live, amber last known, red stale, grey none">
                Evidence
              </th>
              <th className="p5 w-ev">Macro</th>
              <th className="p5 w-ev">Regime</th>
              <th className="p5 w-ev">D1</th>
              <th className="p5 w-ev">H8</th>
              <th className="p5 w-ev">H1</th>
              <th className="p5 w-ev">Risk</th>
              {th('age', 'Age', 'p3 w-age')}
              <th className="pm act" />
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <Fragment key={r.symbol}>
                <tr className={`${expanded === r.symbol ? 'open' : ''} ${r.liveEligible ? '' : 'held'}`} onClick={() => onExpand(expanded === r.symbol ? null : r.symbol)}>
                  <td>
                    <b>{r.symbol}</b>
                    <small>{r.assetClass}</small>
                  </td>
                  <td title={`${r.gateName} · ${r.stagesPassed}/10 gates passed`}>
                    <b>S{r.currentGate}</b> <small>{r.gateName}</small>
                    <small className="passed">{r.stagesPassed}/10 passed</small>
                  </td>
                  <td className="p4">
                    <Progress t={r} />
                  </td>
                  <td>
                    <StateChip state={r.state} />
                  </td>
                  <td className={`p3 dir ${r.direction.toLowerCase()}`}>{r.direction === 'NEUTRAL' ? '—' : r.direction}</td>
                  <td className="pm" title={r.confidenceSource ? `From ${r.confidenceSource}` : 'No stage confidence yet'}>{r.confidence == null ? '—' : `${r.confidence}%`}</td>
                  <td className="pm">
                    <DecisionBadge d={r.decision} />
                  </td>
                  <td className="blocker" title={`${r.blocker}${r.waitingFor ? ` · waiting for ${r.waitingFor}` : ''}`}>
                    <span>{r.blocker || '—'}</span>
                    {r.waitingFor && <small>⏳ {r.waitingFor}</small>}
                  </td>
                  <td className="p2 w-mini">
                    <EvidenceMini t={r} />
                  </td>
                  <Field f={r.macro} className="p5" />
                  <Field f={r.regime} className="p5" />
                  <Field f={r.d1} className="p5" />
                  <Field f={r.h8} className="p5" />
                  <Field f={r.h1} className="p5" />
                  <Field f={r.risk} className="p5" />
                  <td className="p3" title={r.since ? `In this state since ${stamp(r.since)}` : ''}>
                    {age(r.ageSec)}
                  </td>
                  <td className="pm act">
                    <button
                      type="button"
                      className="mini"
                      disabled={Boolean(busy)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReevaluate(r.symbol);
                      }}
                    >
                      Re-evaluate
                    </button>
                  </td>
                </tr>
                {expanded === r.symbol && (
                  <tr className="detail-row">
                    <td colSpan={17}>
                      <Detail t={r} busy={busy} onReevaluate={onReevaluate} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!view.length && (
              <tr>
                <td colSpan={17} className="empty">
                  No instrument matches the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
