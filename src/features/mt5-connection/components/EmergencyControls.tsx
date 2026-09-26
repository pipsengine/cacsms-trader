import React, { useState } from 'react';
import { INSTRUMENTS } from '../data/instruments';

export function EmergencyControls({
  onGlobalStop,
  onInstrumentStop,
}: {
  onGlobalStop?: () => void;
  onInstrumentStop?: (s: string) => void;
}) {
  const [symbol, setSymbol] = useState('EURUSD');
  return (
    <section className="mt5-panel danger-zone">
      <header>
        <div>
          <span className="eyebrow">SAFETY CONTROLS</span>
          <h3>Execution circuit breakers</h3>
        </div>
      </header>
      <div className="mt5-safety-grid">
        <article>
          <b>Global stop</b>
          <p>Blocks all new orders across every connected account. Existing positions remain under normal position management.</p>
          <button type="button" className="mt5-btn mt5-danger" disabled={!onGlobalStop} onClick={onGlobalStop}>
            Block new trading globally
          </button>
        </article>
        <article>
          <b>Instrument stop</b>
          <p>Blocks new entries for a canonical instrument across eligible accounts without disconnecting market data.</p>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {INSTRUMENTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="button" className="mt5-btn mt5-danger" disabled={!onInstrumentStop} onClick={() => onInstrumentStop?.(symbol)}>
            Block {symbol}
          </button>
        </article>
      </div>
      <p className="mt5-note">
        Closing open positions is intentionally a separate explicit workflow; an execution stop must never silently liquidate the
        portfolio.
      </p>
    </section>
  );
}
