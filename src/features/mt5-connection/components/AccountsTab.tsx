import React, { useState } from 'react';
import type { MT5Snapshot } from '../types/mt5.types';
import { money, ago } from '../utils/format';
import { StatusBadge } from './StatusBadge';

export function AccountsTab({ s, onOpen, onAdd }: { s: MT5Snapshot; onOpen: (id: string) => void; onAdd: () => void }) {
  const [filter, setFilter] = useState('ALL');
  const rows = s.accounts.filter(
    (a) =>
      filter === 'ALL' ||
      a.accountClass === filter ||
      a.currency === filter ||
      (filter === 'CONNECTED' && a.state === 'HEALTHY'),
  );

  return (
    <section className="mt5-panel">
      <div className="mt5-section-title">
        <div>
          <b>MT5 Accounts</b>
          <span>Multi-broker, multi-currency account registry</span>
        </div>
        <button type="button" className="mt5-btn mt5-primary" onClick={onAdd}>
          + Add Account
        </button>
      </div>
      <div className="mt5-toolbar">
        {['ALL', 'DEMO', 'LIVE', 'PROP', 'USD', 'NGN', 'CONNECTED'].map((x) => (
          <button type="button" key={x} className={filter === x ? 'active' : ''} onClick={() => setFilter(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="mt5-table-wrap">
        <table className="mt5-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Class</th>
              <th>Broker / Firm</th>
              <th>Currency</th>
              <th>Equity</th>
              <th>Free Margin</th>
              <th>Mode</th>
              <th>Heartbeat</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} onClick={() => onOpen(a.id)}>
                <td>
                  <b>{a.name}</b>
                  <small>
                    {a.login} • {a.server}
                  </small>
                </td>
                <td>
                  {a.accountClass}
                  {a.propRules && <small>{a.propRules.phase}</small>}
                </td>
                <td>{a.firm || a.broker}</td>
                <td>
                  <span className="mt5-currency">{a.currency}</span>
                </td>
                <td>{money(a.equity, a.currency)}</td>
                <td>{money(a.freeMargin, a.currency)}</td>
                <td>{a.tradingMode.replaceAll('_', ' ')}</td>
                <td>{ago(a.lastHeartbeat)}</td>
                <td>
                  <StatusBadge value={a.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
