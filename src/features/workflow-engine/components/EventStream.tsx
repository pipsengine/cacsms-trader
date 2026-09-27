import { useMemo, useState } from 'react';
import type { EventClass, WorkflowEvent } from '../types/workflow';
import { collapseEvents } from '../services/eventModel';
import { clock, human, stamp } from '../utils/format';

const CLASSES: EventClass[] = ['CRITICAL', 'EXECUTION', 'DECISION', 'WARNING', 'INFO', 'TRACE'];
const WINDOWS: [string, number][] = [
  ['All', 0],
  ['5 min', 5],
  ['15 min', 15],
  ['1 hour', 60],
  ['4 hours', 240],
];

export function EventStream({ events, symbols }: { events: WorkflowEvent[]; symbols: string[] }) {
  const [classes, setClasses] = useState<Set<EventClass>>(new Set(CLASSES.filter((c) => c !== 'TRACE')));
  const [symbol, setSymbol] = useState('');
  const [stage, setStage] = useState(0);
  const [type, setType] = useState('');
  const [windowMin, setWindowMin] = useState(0);
  const [importantOnly, setImportantOnly] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const types = useMemo(() => [...new Set(events.map((e) => e.event))].sort(), [events]);
  const groups = useMemo(() => {
    const cutoff = windowMin ? Date.now() - windowMin * 60_000 : 0;
    const filtered = events.filter(
      (e) =>
        classes.has(e.cls) &&
        (!symbol || e.symbol === symbol) &&
        (!stage || e.stage === stage) &&
        (!type || e.event === type) &&
        (!importantOnly || e.tag) &&
        (!cutoff || Date.parse(e.time) >= cutoff),
    );
    return { list: collapseEvents(filtered), count: filtered.length };
  }, [events, classes, symbol, stage, type, windowMin, importantOnly]);

  const toggle = (c: EventClass) =>
    setClasses((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  return (
    <section className="panel">
      <div className="panel-title wrap-title">
        <div>
          <span className="eyebrow">EVENT BUS</span>
          <h2>Real-time Event Stream</h2>
        </div>
        <span className="muted">
          {groups.count} of {events.length} events
        </span>
      </div>
      <div className="event-filters">
        <div className="cls-toggles">
          {CLASSES.map((c) => (
            <button type="button" key={c} className={`cls ${c.toLowerCase()}${classes.has(c) ? ' on' : ''}`} onClick={() => toggle(c)} aria-pressed={classes.has(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="filters">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Instrument">
            <option value="">All instruments</option>
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={stage} onChange={(e) => setStage(Number(e.target.value))} aria-label="Stage">
            <option value={0}>All stages</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                S{i + 1}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {human(t)}
              </option>
            ))}
          </select>
          <select value={windowMin} onChange={(e) => setWindowMin(Number(e.target.value))} aria-label="Time window">
            {WINDOWS.map(([l, m]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={importantOnly} onChange={(e) => setImportantOnly(e.target.checked)} /> Key events only
          </label>
        </div>
      </div>
      <div className="event-list">
        {groups.list.map((g) => {
          const e = g.head;
          const many = g.items.length > 1;
          return (
            <div key={g.key} className={`event-group${e.tag ? ' key' : ''}`}>
              <div className={`event c-${e.cls.toLowerCase()}`} title={stamp(e.time)} onClick={() => many && setOpenGroup(openGroup === g.key ? null : g.key)}>
                <time>{clock(e.time)}</time>
                <span className="stage-tag">S{e.stage}</span>
                <span className={`cls-tag ${e.cls.toLowerCase()}`}>{e.tag ? human(e.tag) : e.cls}</span>
                <b>{e.symbol ?? '—'}</b>
                <p>{e.detail}</p>
                {many ? <em className="count">×{g.items.length}</em> : <em />}
              </div>
              {many && openGroup === g.key && (
                <div className="event-sub">
                  {g.items.slice(1).map((x) => (
                    <div key={x.id} className="event sub">
                      <time>{clock(x.time)}</time>
                      <span className="stage-tag">S{x.stage}</span>
                      <span className="cls-tag">{x.cls}</span>
                      <b>{x.symbol ?? '—'}</b>
                      <p>{x.detail}</p>
                      <em />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!groups.list.length && <p className="empty">No events match the filters.</p>}
      </div>
    </section>
  );
}
