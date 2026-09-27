import React from 'react';
import type { MT5Snapshot } from '../types/mt5.types';
import { MetricCard } from './MetricCard';
import { ConnectionChain } from './ConnectionChain';
import { StatusBadge } from './StatusBadge';
import { money, ago } from '../utils/format';

export function OverviewTab({ s, onAccount }: { s: MT5Snapshot; onAccount: (id: string) => void }) {
  const usd = s.accounts.filter((a) => a.currency === 'USD').reduce((x, a) => x + a.equity, 0);
  const ngn = s.accounts.filter((a) => a.currency === 'NGN').reduce((x, a) => x + a.equity, 0);

  return (
    <div className="mt5-stack">
      <div className="mt5-metrics">
        <MetricCard
          label="Connected Accounts"
          value={`${s.accounts.filter((a) => a.state === 'HEALTHY').length} / ${s.accounts.length}`}
          sub={`${s.accounts.filter((a) => a.accountClass === 'PROP').length} prop firm`}
        />
        <MetricCard label="USD Equity" value={money(usd, 'USD')} sub="Native account values" />
        <MetricCard label="NGN Equity" value={money(ngn, 'NGN')} sub="Native account values" />
        <MetricCard label="Feed Latency" value={`${s.health.feedLatencyMs} ms`} sub={`Heartbeat ${ago(s.health.lastHeartbeat)}`} />
      </div>
      <ConnectionChain health={s.health} />
      <section className="mt5-panel">
        <div className="mt5-section-title">
          <div>
            <b>Account Estate</b>
            <span>Demo, live and prop accounts remain independently controlled</span>
          </div>
        </div>
        {s.accounts.length === 0 ? (
          <div className="mt5-empty">
            <b>No connected terminals</b>
            <span>Register an MT5 account under Accounts to begin live terminal sync.</span>
          </div>
        ) : (
          <div className="mt5-account-grid">
            {s.accounts.map((a) => (
              <button className="mt5-account-card" onClick={() => onAccount(a.id)} key={a.id} type="button">
                <div className="mt5-account-head">
                  <div>
                    <small>
                      {a.accountClass} • {a.currency}
                    </small>
                    <b>{a.name}</b>
                  </div>
                  <StatusBadge value={a.state} />
                </div>
                <div className="mt5-account-money">
                  <span>Equity</span>
                  <strong>{money(a.equity, a.currency)}</strong>
                </div>
                <div className="mt5-account-foot">
                  <span>{a.firm || a.broker}</span>
                  <span>{a.tradingMode.replaceAll('_', ' ')}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
