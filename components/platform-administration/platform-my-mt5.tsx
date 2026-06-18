'use client';

import { FormEvent, useEffect, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PlatformMt5Config, PlatformTradingConfig } from '@/lib/platform-auth/types';
import { toneBadge, toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformMyMt5Page() {
  const auth = usePlatformAuth();
  const userId = auth.user?.id;
  const [mt5, setMt5] = useState<PlatformMt5Config | null>(null);
  const [trading, setTrading] = useState<PlatformTradingConfig | null>(null);
  const [form, setForm] = useState({
    brokerName: '',
    accountNumber: '',
    serverName: '',
    symbol: 'XAUUSD',
    terminalId: '',
    password: '',
    investorPassword: '',
  });
  const [tradingForm, setTradingForm] = useState({
    lotSize: '0.01',
    riskPerTradePercent: '0.5',
    dailyDrawdownPercent: '4',
    maxOpenTrades: '3',
    basketLimit: '3',
    profitLockPercent: '50',
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void fetch(`/api/platform-admin/users/${userId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        setMt5(payload.mt5);
        setTrading(payload.trading);
        setForm((current) => ({
          ...current,
          brokerName: payload.mt5.brokerName,
          accountNumber: payload.mt5.accountNumber,
          serverName: payload.mt5.serverName,
          symbol: payload.mt5.symbol,
          terminalId: payload.mt5.terminalId ?? '',
        }));
        setTradingForm({
          lotSize: String(payload.trading.lotSize),
          riskPerTradePercent: String(payload.trading.riskPerTradePercent),
          dailyDrawdownPercent: String(payload.trading.dailyDrawdownPercent),
          maxOpenTrades: String(payload.trading.maxOpenTrades),
          basketLimit: String(payload.trading.basketLimit),
          profitLockPercent: String(payload.trading.profitLockPercent),
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load MT5 config.'));
  }, [userId]);

  async function saveMt5(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/platform-admin/users/${userId}/mt5-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brokerName: form.brokerName,
        accountNumber: form.accountNumber,
        serverName: form.serverName,
        symbol: form.symbol,
        terminalId: form.terminalId || null,
        password: form.password || undefined,
        investorPassword: form.investorPassword || undefined,
        connectionStatus: 'configured',
      }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setMt5(payload.mt5);
    setForm((c) => ({ ...c, password: '', investorPassword: '' }));
    setMessage('MT5 connection settings saved (credentials encrypted at rest).');
  }

  async function saveTrading(patch: Partial<PlatformTradingConfig>) {
    if (!userId) return;
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/platform-admin/users/${userId}/trading-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setTrading(payload.trading);
    setMessage('Trading configuration updated.');
  }

  async function saveTradingForm(event: FormEvent) {
    event.preventDefault();
    await saveTrading({
      lotSize: Number(tradingForm.lotSize),
      riskPerTradePercent: Number(tradingForm.riskPerTradePercent),
      dailyDrawdownPercent: Number(tradingForm.dailyDrawdownPercent),
      maxOpenTrades: Number(tradingForm.maxOpenTrades),
      basketLimit: Number(tradingForm.basketLimit),
      profitLockPercent: Number(tradingForm.profitLockPercent),
      profitLockEnabled: true,
      tradingEnabled: trading?.tradingEnabled,
    });
  }

  return (
    <PlatformAuthGate>
      <PlatformAdminShell
        title="My MT5 connection"
        subtitle="Isolated terminal credentials and Gold engine controls for your account"
      >
        {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        <div className="mb-4 flex flex-wrap gap-2">
          <Badge className={toneBadge(mt5?.connectionStatus === 'connected' ? 'emerald' : 'slate')}>
            MT5: {mt5?.connectionStatus ?? 'unknown'}
          </Badge>
          <Badge className={toneBadge(trading?.goldEngineEnabled ? 'purple' : 'slate')}>
            Gold engine: {trading?.goldEngineEnabled ? 'enabled' : 'disabled'}
          </Badge>
          <Badge className={toneBadge(trading?.tradingEnabled ? 'cyan' : 'slate')}>
            Trading: {trading?.tradingEnabled ? 'enabled' : 'disabled'}
          </Badge>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className={toneCard('cyan')}>
            <CardHeader className={toneCardHeader('cyan')}>
              <CardTitle className={toneTitle('cyan')}>MT5 terminal</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form className="space-y-3" onSubmit={saveMt5}>
                <Input label="Broker" value={form.brokerName} onChange={(v) => setForm((c) => ({ ...c, brokerName: v }))} />
                <Input label="Account number" value={form.accountNumber} onChange={(v) => setForm((c) => ({ ...c, accountNumber: v }))} />
                <Input label="Server" value={form.serverName} onChange={(v) => setForm((c) => ({ ...c, serverName: v }))} />
                <Input label="Symbol" value={form.symbol} onChange={(v) => setForm((c) => ({ ...c, symbol: v }))} />
                <Input label="Terminal ID (optional)" value={form.terminalId} onChange={(v) => setForm((c) => ({ ...c, terminalId: v }))} />
                <Input label="MT5 password" type="password" value={form.password} onChange={(v) => setForm((c) => ({ ...c, password: v }))} placeholder={mt5?.hasPassword ? '•••••••• (stored)' : ''} />
                <Input label="Investor password" type="password" value={form.investorPassword} onChange={(v) => setForm((c) => ({ ...c, investorPassword: v }))} placeholder={mt5?.hasInvestorPassword ? '•••••••• (stored)' : ''} />
                <Button type="submit">Save MT5 settings</Button>
              </form>
            </CardContent>
          </Card>

          <Card className={toneCard('purple')}>
            <CardHeader className={toneCardHeader('purple')}>
              <CardTitle className={toneTitle('purple')}>Gold trading configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={trading?.goldEngineEnabled ? 'outline' : 'default'}
                  onClick={() => void saveTrading({ goldEngineEnabled: !trading?.goldEngineEnabled })}
                >
                  {trading?.goldEngineEnabled ? 'Disable Gold engine' : 'Enable Gold engine'}
                </Button>
                <Button
                  type="button"
                  variant={trading?.tradingEnabled ? 'outline' : 'default'}
                  onClick={() => void saveTrading({ tradingEnabled: !trading?.tradingEnabled })}
                >
                  {trading?.tradingEnabled ? 'Disable trading' : 'Enable trading'}
                </Button>
              </div>
              <form className="space-y-3" onSubmit={saveTradingForm}>
                <Input label="Lot size" value={tradingForm.lotSize} onChange={(v) => setTradingForm((c) => ({ ...c, lotSize: v }))} />
                <Input label="Risk per trade %" value={tradingForm.riskPerTradePercent} onChange={(v) => setTradingForm((c) => ({ ...c, riskPerTradePercent: v }))} />
                <Input label="Daily drawdown %" value={tradingForm.dailyDrawdownPercent} onChange={(v) => setTradingForm((c) => ({ ...c, dailyDrawdownPercent: v }))} />
                <Input label="Max open trades" value={tradingForm.maxOpenTrades} onChange={(v) => setTradingForm((c) => ({ ...c, maxOpenTrades: v }))} />
                <Input label="Basket limit" value={tradingForm.basketLimit} onChange={(v) => setTradingForm((c) => ({ ...c, basketLimit: v }))} />
                <Input label="Profit lock %" value={tradingForm.profitLockPercent} onChange={(v) => setTradingForm((c) => ({ ...c, profitLockPercent: v }))} />
                <Button type="submit">Save risk settings</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}

function Input(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-slate-700">{props.label}</span>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </label>
  );
}
