import React, { useState } from 'react';
import type { MT5Snapshot } from '../types/mt5.types';
import { MetricCard } from './MetricCard';
import { StatusBadge } from './StatusBadge';

export function LogsHealthTab({ s }: { s: MT5Snapshot }) {
  const [f, setF] = useState('ALL');
  const events = s.events.filter((e) => f === 'ALL' || e.severity === f || e.category === f);

  return (
    <div className="mt5-stack">
      <div className="mt5-metrics">
        <MetricCard label="Bridge" value={s.health.bridge} />
        <MetricCard label="Market Data" value={s.health.marketData} />
        <MetricCard label="Heartbeat" value={s.health.heartbeat} />
        <MetricCard label="Reconciliation" value={s.health.reconciliation} />
      </div>
      <section className="mt5-panel">
        <div className="mt5-section-title">
          <div>
            <b>Runtime Health</b>
            <span>Fail-closed execution health and reconnection telemetry</span>
          </div>
          <StatusBadge value={s.health.orderGateway} />
        </div>
        <div className="mt5-health-grid">
          <div>
            <span>Feed latency</span>
            <b>{s.health.feedLatencyMs} ms</b>
          </div>
          <div>
            <span>Queue depth</span>
            <b>{s.health.queueDepth}</b>
          </div>
          <div>
            <span>Reconnect attempts</span>
            <b>{s.health.reconnectAttempts}</b>
          </div>
          <div>
            <span>Last heartbeat</span>
            <b>{new Date(s.health.lastHeartbeat).toLocaleTimeString()}</b>
          </div>
        </div>
      </section>
      <section className="mt5-panel">
        <div className="mt5-section-title">
          <div>
            <b>Live Events</b>
            <span>Connection, market data, orders, positions and compliance</span>
          </div>
        </div>
        <div className="mt5-toolbar">
          {['ALL', 'INFO', 'WARNING', 'ERROR', 'TRADE', 'CONNECTION', 'ORDER'].map((x) => (
            <button type="button" key={x} className={f === x ? 'active' : ''} onClick={() => setF(x)}>
              {x}
            </button>
          ))}
        </div>
        <div className="mt5-events">
          {events.map((e) => (
            <div className="mt5-event" key={e.id}>
              <time>{new Date(e.timestamp).toLocaleTimeString()}</time>
              <StatusBadge value={e.severity} />
              <span>{e.symbol || 'SYSTEM'}</span>
              <p>{e.message}</p>
              <small>{e.accountId ? s.accounts.find((a) => a.id === e.accountId)?.name : ''}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
