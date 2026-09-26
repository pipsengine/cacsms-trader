import React, { useMemo, useState } from 'react';
import type { MT5ConnectionSource, MT5Snapshot } from '../types/mt5.types';
import { TIMEFRAMES } from '../data/instruments';
import { StatusBadge } from './StatusBadge';

export function SymbolsDataTab({ s, source }: { s: MT5Snapshot; source?: MT5ConnectionSource }) {
  const [account, setAccount] = useState(s.accounts[0]?.id || '');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [brokerSymbol, setBrokerSymbol] = useState('');

  const maps = useMemo(
    () => s.symbolMaps.filter((x) => x.accountId === account && x.canonical.includes(q.toUpperCase())),
    [s, account, q],
  );
  const cov = (sym: string) => s.coverage.find((x) => x.accountId === account && x.symbol === sym);

  const saveMap = async (canonical: string) => {
    const current = maps.find((m) => m.canonical === canonical);
    if (!current || !source?.saveSymbolMap) return;
    await source.saveSymbolMap({ ...current, brokerSymbol: brokerSymbol || current.brokerSymbol, status: 'MAPPED' });
    setEditing(null);
  };

  return (
    <section className="mt5-panel">
      <div className="mt5-section-title">
        <div>
          <b>Symbols & Market Data</b>
          <span>Canonical 29-instrument universe mapped independently per account</span>
        </div>
      </div>
      <div className="mt5-filters">
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          {s.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} • {a.currency}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search EURUSD, XAUUSD…" />
      </div>
      <div className="mt5-table-wrap">
        <table className="mt5-table">
          <thead>
            <tr>
              <th>Cacsms</th>
              <th>Broker Symbol</th>
              <th>Mapping</th>
              <th>Spread</th>
              <th>Lot Range</th>
              {TIMEFRAMES.map((t) => (
                <th key={t}>{t}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {maps.map((m) => (
              <tr key={m.canonical}>
                <td>
                  <b>{m.canonical}</b>
                </td>
                <td>
                  {editing === m.canonical ? (
                    <input value={brokerSymbol} onChange={(e) => setBrokerSymbol(e.target.value)} style={{ width: 110 }} />
                  ) : (
                    m.brokerSymbol
                  )}
                </td>
                <td>
                  <StatusBadge value={m.status} />
                </td>
                <td>{m.spread}</td>
                <td>
                  {m.minLot}–{m.maxLot}
                </td>
                {TIMEFRAMES.map((t) => {
                  const x = cov(m.canonical)?.timeframes[t];
                  return (
                    <td
                      key={t}
                      className={x?.available && !x.stale ? 'mt5-ok' : 'mt5-warn'}
                      title={x ? `${x.bars.toLocaleString()} bars` : 'No data'}
                    >
                      {x?.available ? '●' : '—'}
                    </td>
                  );
                })}
                <td>
                  {editing === m.canonical ? (
                    <button type="button" className="mt5-btn" onClick={() => saveMap(m.canonical)}>
                      Save
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mt5-btn"
                      disabled={!source?.saveSymbolMap}
                      onClick={() => {
                        setEditing(m.canonical);
                        setBrokerSymbol(m.brokerSymbol);
                      }}
                    >
                      Map
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt5-notice">
        H8 and other canonical bars must be normalized by the integration layer. Downstream trading engines should consume
        Cacsms canonical data, not broker-specific symbol/timeframe quirks.
      </div>
    </section>
  );
}
