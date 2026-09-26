import React, { useMemo, useState } from 'react';
import type { MT5ConnectionSource } from './types/mt5.types';
import { createCacsmsMT5Source } from './services/cacsmsMT5Source';
import { createDemoMT5Source } from './services/demoMT5Source';
import { useMT5Connection } from './hooks/useMT5Connection';
import { OverviewTab } from './components/OverviewTab';
import { AccountsTab } from './components/AccountsTab';
import { SymbolsDataTab } from './components/SymbolsDataTab';
import { TradingTab } from './components/TradingTab';
import { LogsHealthTab } from './components/LogsHealthTab';
import { AccountDrawer } from './components/AccountDrawer';
import { AddAccountModal } from './components/AddAccountModal';
import { StatusBadge } from './components/StatusBadge';
import { EmergencyControls } from './components/EmergencyControls';
import './styles/mt5-connection.css';

type Tab = 'OVERVIEW' | 'ACCOUNTS' | 'SYMBOLS & DATA' | 'TRADING' | 'LOGS & HEALTH';

export function MT5ConnectionPage({
  source: provided,
  useDemoFallback = false,
}: {
  source?: MT5ConnectionSource;
  useDemoFallback?: boolean;
}) {
  const integrated = useMemo(() => (useDemoFallback ? createDemoMT5Source() : createCacsmsMT5Source()), [useDemoFallback]);
  const source = provided || integrated;
  const { data: s, busy, error, refresh, command } = useMT5Connection(source);
  const [tab, setTab] = useState<Tab>('OVERVIEW');
  const [selected, setSelected] = useState<string | null>(null);
  const [add, setAdd] = useState(false);

  if (!s) {
    return (
      <div className="mt5-shell">
        <div className="mt5-loading">Initializing MT5 Connection Centre…</div>
      </div>
    );
  }

  const account = s.accounts.find((a) => a.id === selected) || null;

  return (
    <div className="mt5-shell">
      <header className="mt5-page-head">
        <div>
          <div className="mt5-eyebrow">SYSTEM / EXECUTION INFRASTRUCTURE</div>
          <h1>MT5 Connection</h1>
          <p>Multi-account gateway for Demo, Live and Prop Firm trading • USD / NGN / multi-currency ready</p>
        </div>
        <div className="mt5-head-actions">
          <StatusBadge value={s.health.bridge} />
          <button type="button" className="mt5-btn" onClick={() => refresh()}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {useDemoFallback && !provided && (
        <div className="mt5-demo-banner">
          <b>Demo source:</b> isolated simulator active. Production routes use the integrated Cacsms MT5 runtime.
        </div>
      )}
      {error && <div className="mt5-error">{error}</div>}

      <nav className="mt5-tabs" aria-label="MT5 Connection sections">
        {(['OVERVIEW', 'ACCOUNTS', 'SYMBOLS & DATA', 'TRADING', 'LOGS & HEALTH'] as Tab[]).map((t) => (
          <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === 'OVERVIEW' && <OverviewTab s={s} onAccount={setSelected} />}
      {tab === 'ACCOUNTS' && <AccountsTab s={s} onOpen={setSelected} onAdd={() => setAdd(true)} />}
      {tab === 'SYMBOLS & DATA' && <SymbolsDataTab s={s} source={source} />}
      {tab === 'TRADING' && (
        <>
          <TradingTab
            s={s}
            onOpen={setSelected}
            onToggleGlobal={() =>
              command('global', async () => source.setGlobalTrading?.(!s.globalTradingEnabled) ?? { ok: false, message: 'Unavailable' })
            }
          />
          <EmergencyControls
            onGlobalStop={() => command('estop', async () => source.emergencyStop?.({}) ?? { ok: false, message: 'Unavailable' })}
            onInstrumentStop={(symbol) =>
              command('estop-sym', async () => source.emergencyStop?.({ symbol }) ?? { ok: false, message: 'Unavailable' })
            }
          />
        </>
      )}
      {tab === 'LOGS & HEALTH' && <LogsHealthTab s={s} />}

      <AccountDrawer
        account={account}
        onClose={() => setSelected(null)}
        onToggle={(a) =>
          command('toggle-' + a.id, async () => source.setAccountTrading?.(a.id, !a.tradingEnabled) ?? { ok: false, message: 'Unavailable' })
        }
        onReconnect={(a) => command('reconnect-' + a.id, async () => source.reconnect?.(a.id) ?? { ok: false, message: 'Unavailable' })}
        onReconcile={(a) => command('reconcile-' + a.id, async () => source.reconcile?.(a.id) ?? { ok: false, message: 'Unavailable' })}
        onDisconnect={(a) => command('disconnect-' + a.id, async () => source.disconnect?.(a.id) ?? { ok: false, message: 'Unavailable' })}
        onConnect={(a) => command('connect-' + a.id, async () => source.connect?.(a.id) ?? { ok: false, message: 'Unavailable' })}
        source={source}
        onCommand={command}
      />
      <AddAccountModal open={add} onClose={() => setAdd(false)} source={source} onSaved={() => setAdd(false)} />
      {busy && <div className="mt5-busy">Processing secure command…</div>}
    </div>
  );
}
