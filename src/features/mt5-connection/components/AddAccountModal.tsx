import React, { useEffect, useMemo, useState } from 'react';
import type { AccountClass, AccountCurrency, MT5ConnectionSource } from '../types/mt5.types';
import { brokersForAccountClass, serversForBroker } from '../data/brokerCatalog';
import { nextTerminalInstanceId } from '../utils/terminalInstance';

const ACCOUNT_TYPES: { value: AccountClass; label: string }[] = [
  { value: 'DEMO', label: 'Demo' },
  { value: 'LIVE', label: 'Live' },
  { value: 'PROP', label: 'Prop Firm' },
];

const emptyForm = (terminalInstance: string) => ({
  name: '',
  broker: '',
  firm: '',
  server: '',
  login: '',
  password: '',
  terminalInstance,
});

export function AddAccountModal({
  open,
  onClose,
  source,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  source: MT5ConnectionSource;
  onSaved?: () => void;
}) {
  const [kind, setKind] = useState<AccountClass>('DEMO');
  const [currency, setCurrency] = useState<AccountCurrency>('USD');
  const [terminalInstance, setTerminalInstance] = useState('CACSMS-MT5-0001');
  const [form, setForm] = useState(() => emptyForm('CACSMS-MT5-0001'));
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const brokers = useMemo(() => brokersForAccountClass(kind), [kind]);
  const servers = useMemo(() => serversForBroker(form.broker), [form.broker]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await Promise.resolve(source.getSnapshot());
        const next = nextTerminalInstanceId(snap.accounts.map((a) => a.terminalInstance));
        if (cancelled) return;
        setTerminalInstance(next);
        setForm((x) => ({ ...x, terminalInstance: next }));
        setResult('');
        setSaveMsg('');
      } catch {
        if (cancelled) return;
        const next = nextTerminalInstanceId([]);
        setTerminalInstance(next);
        setForm((x) => ({ ...x, terminalInstance: next }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, source]);

  if (!open) return null;

  const set = (k: string, v: string) => setForm((x) => ({ ...x, [k]: v }));

  const onAccountTypeChange = (next: AccountClass) => {
    setKind(next);
    const nextBrokers = brokersForAccountClass(next);
    const broker = nextBrokers[0]?.name ?? '';
    const server = nextBrokers[0]?.servers[0] ?? '';
    setForm((x) => ({
      ...x,
      broker,
      firm: next === 'PROP' ? broker : '',
      server,
      terminalInstance,
    }));
  };

  const onBrokerChange = (broker: string) => {
    const list = serversForBroker(broker);
    setForm((x) => ({
      ...x,
      broker,
      firm: kind === 'PROP' ? broker : x.firm,
      server: list[0] ?? '',
      terminalInstance,
    }));
  };

  const test = async () => {
    setBusy(true);
    setResult('');
    try {
      const r = await source.testConnection?.({
        name: form.name,
        broker: form.broker,
        firm: form.firm,
        server: form.server,
        login: form.login,
        terminalInstance,
        accountClass: kind,
        currency,
        password: form.password,
      });
      setResult(r?.message || 'Test capability is not connected');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!source.saveAccount) return;
    setBusy(true);
    setSaveMsg('');
    try {
      const snap = await Promise.resolve(source.getSnapshot());
      const assigned = nextTerminalInstanceId(snap.accounts.map((a) => a.terminalInstance));
      const r = await source.saveAccount({
        name: form.name,
        accountClass: kind,
        currency,
        broker: form.broker,
        firm: kind === 'PROP' ? form.broker || form.firm : undefined,
        server: form.server,
        login: form.login,
        terminalInstance: assigned,
        ...({ password: form.password } as object),
      });
      setSaveMsg(r?.message || 'Saved');
      if (r?.ok) {
        const following = nextTerminalInstanceId([...snap.accounts.map((a) => a.terminalInstance), assigned]);
        setTerminalInstance(following);
        setForm(emptyForm(following));
        onSaved?.();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt5-overlay">
      <div className="mt5-modal">
        <header>
          <div>
            <small>SECURE CONNECTION PROFILE</small>
            <h2>Add MT5 Account</h2>
          </div>
          <button type="button" className="mt5-icon" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="mt5-form-grid">
          <label>
            Account Type
            <select value={kind} onChange={(e) => onAccountTypeChange(e.target.value as AccountClass)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Account Name
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Nigeria Live" />
          </label>

          <label>
            {kind === 'PROP' ? 'Prop Firm / Broker' : 'Broker'}
            <select value={form.broker} onChange={(e) => onBrokerChange(e.target.value)}>
              <option value="" disabled>
                Select broker
              </option>
              {brokers.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            MT5 Server
            <select
              value={form.server}
              onChange={(e) => set('server', e.target.value)}
              disabled={!form.broker || servers.length === 0}
            >
              <option value="" disabled>
                {form.broker ? 'Select server' : 'Select a broker first'}
              </option>
              {servers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            Account Number
            <input
              value={form.login}
              onChange={(e) => set('login', e.target.value)}
              placeholder="MT5 account number"
              inputMode="numeric"
              autoComplete="username"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder="MT5 investor or master password"
              autoComplete="current-password"
            />
          </label>

          <label>
            Terminal Instance
            <div className="mt5-readonly-field" title="Auto-generated as CACSMS-MT5-####" aria-live="polite">
              {terminalInstance}
            </div>
          </label>

          <label>
            Expected Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="NGN">NGN</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
        </div>

        <div className="mt5-notice">
          Account currency (USD, NGN or other supported deposit currency) must be detected and verified from MT5 after
          authentication. Credentials should be passed to your secure secret store, not saved by this UI. Terminal instance
          IDs are assigned automatically as CACSMS-MT5-#### and cannot be edited.
        </div>
        {result && <div className="mt5-test-result">✓ {result}</div>}
        {saveMsg && <div className="mt5-test-result">{saveMsg}</div>}

        <footer>
          <button type="button" className="mt5-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="mt5-btn" disabled={busy || !form.broker || !form.server || !form.login} onClick={test}>
            {busy ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            type="button"
            className="mt5-btn mt5-primary"
            disabled={busy || !source.saveAccount || !form.name || !form.broker || !form.server || !form.login || !form.password}
            onClick={save}
          >
            Save Account
          </button>
        </footer>
      </div>
    </div>
  );
}
