import { useMemo, useState } from 'react';
import type { InstrumentTrace } from '../types/workflow';

export function InstrumentTraceTable({
  rows,
  onReevaluate,
}: {
  rows: InstrumentTrace[];
  onReevaluate: (s: string) => void;
}) {
  const [q, setQ] = useState('');
  const [decision, setDecision] = useState('ALL');
  const stageCount = Math.max(1, ...rows.map((r) => r.stage), 10);
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => r.symbol.includes(q.toUpperCase()) && (decision === 'ALL' || r.decision === decision),
      ),
    [rows, q, decision],
  );

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">{rows.length}-INSTRUMENT TRACE</span>
          <h2>End-to-End Instrument State</h2>
        </div>
        <div className="filters">
          <input placeholder="Search symbol" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option>ALL</option>
            <option>WAIT</option>
            <option>READY</option>
            <option>BLOCKED</option>
            <option>OPEN</option>
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Macro</th>
              <th>Regime</th>
              <th>D1</th>
              <th>H8</th>
              <th>H1</th>
              <th>Risk</th>
              <th>Stage</th>
              <th>Confidence</th>
              <th>Decision</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.symbol}>
                <td>
                  <b>{r.symbol}</b>
                  <small>{r.assetClass}</small>
                </td>
                <td>{r.macro}</td>
                <td>{r.regime}</td>
                <td>{r.d1}</td>
                <td>{r.h8}</td>
                <td>{r.h1}</td>
                <td>{r.risk}</td>
                <td>
                  <span className="pill">
                    {r.stage}/{stageCount}
                  </span>
                </td>
                <td>{r.confidence}%</td>
                <td>
                  <span className={'badge ' + r.decision.toLowerCase()}>{r.decision}</span>
                </td>
                <td>
                  <button className="mini" onClick={() => onReevaluate(r.symbol)}>
                    Re-evaluate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
