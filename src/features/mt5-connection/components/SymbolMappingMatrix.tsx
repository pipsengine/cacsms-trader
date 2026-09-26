import React, { useMemo, useState } from 'react';

export type SymbolMapRow = {
  canonical: string;
  brokerSymbol: string;
  enabled: boolean;
  tick: boolean;
  m1: boolean;
  m5: boolean;
  m15: boolean;
  h1: boolean;
  h4: boolean;
  h8: boolean;
  d1: boolean;
  w1: boolean;
  mn1: boolean;
  spread: number;
  digits: number;
  contractSize: number;
  lastTick: string;
};

export function SymbolMappingMatrix({ rows, onEdit }: { rows: SymbolMapRow[]; onEdit?: (r: SymbolMapRow) => void }) {
  const [q, setQ] = useState('');
  const v = useMemo(
    () => rows.filter((r) => (r.canonical + ' ' + r.brokerSymbol).toLowerCase().includes(q.toLowerCase())),
    [rows, q],
  );

  return (
    <section className="mt5-panel">
      <header>
        <div>
          <span className="eyebrow">SYMBOL MAPPING</span>
          <h3>Canonical universe → broker symbols</h3>
        </div>
        <input className="mt5-search" placeholder="Search symbol…" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <div className="mt5-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cacsms</th>
              <th>Broker symbol</th>
              <th>Spread</th>
              <th>Digits</th>
              <th>Contract</th>
              <th>Tick</th>
              <th>H1</th>
              <th>H8</th>
              <th>D1</th>
              <th>W1</th>
              <th>MN1</th>
              <th>Last tick</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {v.map((r) => (
              <tr key={r.canonical}>
                <td>
                  <b>{r.canonical}</b>
                </td>
                <td>{r.brokerSymbol}</td>
                <td>{r.spread}</td>
                <td>{r.digits}</td>
                <td>{r.contractSize.toLocaleString()}</td>
                <td>{r.tick ? '✓' : '—'}</td>
                <td>{r.h1 ? '✓' : '—'}</td>
                <td>{r.h8 ? '✓' : 'Synth'}</td>
                <td>{r.d1 ? '✓' : '—'}</td>
                <td>{r.w1 ? '✓' : '—'}</td>
                <td>{r.mn1 ? '✓' : '—'}</td>
                <td>{r.lastTick}</td>
                <td>
                  <button type="button" onClick={() => onEdit?.(r)}>
                    Map
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
