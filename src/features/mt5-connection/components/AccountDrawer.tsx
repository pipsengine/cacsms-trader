import React, { useState } from 'react';
import type { MT5Account, MT5ConnectionSource, PropRules, TradingMode } from '../types/mt5.types';
import { money, pct } from '../utils/format';
import { StatusBadge } from './StatusBadge';
import { mt5SavePropRules, mt5SetTradingMode } from '../services/cacsmsMT5Runtime';

export function AccountDrawer({
  account,
  onClose,
  onToggle,
  onReconnect,
  onReconcile,
  onDisconnect,
  onConnect,
  source,
  onCommand,
}: {
  account: MT5Account | null;
  onClose: () => void;
  onToggle: (a: MT5Account) => void;
  onReconnect: (a: MT5Account) => void;
  onReconcile: (a: MT5Account) => void;
  onDisconnect?: (a: MT5Account) => void;
  onConnect?: (a: MT5Account) => void;
  source?: MT5ConnectionSource;
  onCommand?: (key: string, fn?: () => Promise<unknown>) => Promise<void>;
}) {
  const [editingProp, setEditingProp] = useState(false);
  if (!account) return null;
  const p = account.propRules;

  return (
    <div className="mt5-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="mt5-drawer">
        <header>
          <div>
            <small>
              {account.accountClass} • {account.currency}
            </small>
            <h2>{account.name}</h2>
            <StatusBadge value={account.state} />
          </div>
          <button type="button" className="mt5-icon" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="mt5-drawer-grid">
          <div>
            <span>Broker / Firm</span>
            <b>{account.firm || account.broker}</b>
          </div>
          <div>
            <span>Server</span>
            <b>{account.server}</b>
          </div>
          <div>
            <span>Login</span>
            <b>{account.login}</b>
          </div>
          <div>
            <span>Leverage</span>
            <b>1:{account.leverage}</b>
          </div>
          <div>
            <span>Balance</span>
            <b>{money(account.balance, account.currency)}</b>
          </div>
          <div>
            <span>Equity</span>
            <b>{money(account.equity, account.currency)}</b>
          </div>
          <div>
            <span>Margin</span>
            <b>{money(account.margin, account.currency)}</b>
          </div>
          <div>
            <span>Free Margin</span>
            <b>{money(account.freeMargin, account.currency)}</b>
          </div>
        </div>

        <section className="mt5-subpanel">
          <h3>Trading Mode</h3>
          <div className="mt5-segment">
            {(['ANALYSIS_ONLY', 'APPROVAL_REQUIRED', 'AUTONOMOUS'] as TradingMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                className={account.tradingMode === mode ? 'active' : ''}
                onClick={() => onCommand?.('mode-' + account.id, () => mt5SetTradingMode(account.id, mode))}
              >
                {mode.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
        </section>

        {p && (
          <section className="mt5-subpanel">
            <h3>Prop Firm Compliance Profile</h3>
            {!editingProp ? (
              <>
                <div className="mt5-rule-grid">
                  <div>
                    <span>Phase</span>
                    <b>{p.phase}</b>
                  </div>
                  <div>
                    <span>Daily Loss Limit</span>
                    <b>{pct(p.dailyLossLimitPct)}</b>
                  </div>
                  <div>
                    <span>Maximum Loss</span>
                    <b>{pct(p.maxLossLimitPct)}</b>
                  </div>
                  <div>
                    <span>Profit Target</span>
                    <b>{pct(p.profitTargetPct)}</b>
                  </div>
                  <div>
                    <span>News Trading</span>
                    <b>{p.newsTrading ? 'Allowed' : 'Restricted'}</b>
                  </div>
                  <div>
                    <span>Weekend Holding</span>
                    <b>{p.weekendHolding ? 'Allowed' : 'Restricted'}</b>
                  </div>
                </div>
                <button type="button" className="mt5-btn" style={{ marginTop: 10 }} onClick={() => setEditingProp(true)}>
                  Edit Prop Rules
                </button>
              </>
            ) : (
              <PropInlineEditor
                value={p}
                onCancel={() => setEditingProp(false)}
                onSave={(rules) => {
                  onCommand?.('prop-' + account.id, () => mt5SavePropRules(account.id, rules));
                  setEditingProp(false);
                }}
              />
            )}
          </section>
        )}

        <section className="mt5-subpanel">
          <h3>Execution Assignment</h3>
          <p>
            {account.assignedSymbols.length} canonical instruments • {account.riskProfile} risk • max {account.maxConcurrentTrades}{' '}
            concurrent trades
          </p>
          <p>
            Mode: <b>{account.tradingMode.replaceAll('_', ' ')}</b>
          </p>
        </section>

        <footer>
          {account.state === 'DISCONNECTED' || account.state === 'ERROR' ? (
            <button type="button" className="mt5-btn mt5-primary" onClick={() => onConnect?.(account)}>
              Connect
            </button>
          ) : (
            <button type="button" className="mt5-btn" onClick={() => onDisconnect?.(account)}>
              Disconnect
            </button>
          )}
          <button type="button" className="mt5-btn" onClick={() => onReconcile(account)}>
            Reconcile
          </button>
          <button type="button" className="mt5-btn" onClick={() => onReconnect(account)}>
            Reconnect
          </button>
          <button
            type="button"
            className={account.tradingEnabled ? 'mt5-btn mt5-danger' : 'mt5-btn mt5-primary'}
            onClick={() => onToggle(account)}
          >
            {account.tradingEnabled ? 'Pause New Trades' : 'Enable Trading'}
          </button>
        </footer>
        {source && <span style={{ display: 'none' }}>{source ? 1 : 0}</span>}
      </aside>
    </div>
  );
}

function PropInlineEditor({
  value,
  onSave,
  onCancel,
}: {
  value: PropRules;
  onSave: (v: PropRules) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  return (
    <div className="mt5-form-grid">
      <label>
        Phase
        <select value={v.phase} onChange={(e) => setV({ ...v, phase: e.target.value as PropRules['phase'] })}>
          <option>CHALLENGE</option>
          <option>VERIFICATION</option>
          <option>FUNDED</option>
        </select>
      </label>
      <label>
        Account Size
        <input type="number" value={v.accountSize} onChange={(e) => setV({ ...v, accountSize: Number(e.target.value) })} />
      </label>
      <label>
        Daily Loss %
        <input type="number" value={v.dailyLossLimitPct} onChange={(e) => setV({ ...v, dailyLossLimitPct: Number(e.target.value) })} />
      </label>
      <label>
        Max Loss %
        <input type="number" value={v.maxLossLimitPct} onChange={(e) => setV({ ...v, maxLossLimitPct: Number(e.target.value) })} />
      </label>
      <label>
        Profit Target %
        <input type="number" value={v.profitTargetPct} onChange={(e) => setV({ ...v, profitTargetPct: Number(e.target.value) })} />
      </label>
      <label>
        Max Exposure %
        <input type="number" value={v.maxExposurePct} onChange={(e) => setV({ ...v, maxExposurePct: Number(e.target.value) })} />
      </label>
      <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1' }}>
        <button type="button" className="mt5-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mt5-btn mt5-primary" onClick={() => onSave(v)}>
          Save Rules
        </button>
      </div>
    </div>
  );
}
