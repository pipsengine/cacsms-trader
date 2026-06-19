'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';
import { PLATFORM_ROLES, PLATFORM_USER_STATUSES } from '@/lib/platform-auth/types';
import type {
  PlatformEaInstance,
  PlatformMt5Config,
  PlatformRole,
  PlatformTradingAccountLink,
  PlatformTradingConfig,
  PlatformUserPublic,
  PlatformUserStatus,
} from '@/lib/platform-auth/types';
import { roleLabel } from '@/lib/platform-auth/rbac';
import { toneBadge, toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';
import { cn } from '@/lib/utils';

export function PlatformUserDetailPage({ userId }: { userId: string }) {
  const auth = usePlatformAuth();
  const [user, setUser] = useState<PlatformUserPublic | null>(null);
  const [mt5, setMt5] = useState<PlatformMt5Config | null>(null);
  const [trading, setTrading] = useState<PlatformTradingConfig | null>(null);
  const [accounts, setAccounts] = useState<PlatformTradingAccountLink[]>([]);
  const [eaInstances, setEaInstances] = useState<PlatformEaInstance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState({ displayName: '', role: 'trader' as PlatformRole, status: 'active' as PlatformUserStatus, password: '' });
  const [accountForm, setAccountForm] = useState({ label: '', accountNumber: '', brokerName: '', serverName: '', terminalId: '', isPrimary: false });

  async function loadAll() {
    const [userRes, accountsRes] = await Promise.all([
      fetch(`/api/platform-admin/users/${userId}`, { cache: 'no-store' }),
      fetch(`/api/platform-admin/users/${userId}/trading-accounts`, { cache: 'no-store' }),
    ]);
    const userPayload = await userRes.json();
    const accountsPayload = await accountsRes.json();
    if (!userPayload.ok) throw new Error(userPayload.error);
    setUser(userPayload.user);
    setMt5(userPayload.mt5);
    setTrading(userPayload.trading);
    setEdit({
      displayName: userPayload.user.displayName,
      role: userPayload.user.role,
      status: userPayload.user.status,
      password: '',
    });
    if (accountsPayload.ok) {
      setAccounts(accountsPayload.accounts ?? []);
      setEaInstances(accountsPayload.eaInstances ?? []);
    }
  }

  useEffect(() => {
    void loadAll().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load user.'));
  }, [userId]);

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {
      displayName: edit.displayName,
      role: edit.role,
      status: edit.status,
    };
    if (edit.password) body.password = edit.password;
    const response = await fetch(`/api/platform-admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setEdit((current) => ({ ...current, password: '' }));
    await loadAll();
  }

  async function saveTrading(patch: Partial<PlatformTradingConfig>) {
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
  }

  async function addAccount(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/platform-admin/users/${userId}/trading-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accountForm),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setAccountForm({ label: '', accountNumber: '', brokerName: '', serverName: '', terminalId: '', isPrimary: false });
    await loadAll();
  }

  if (!user) {
    return (
      <PlatformAuthGate>
        <PlatformAdminShell title="User detail" subtitle="Loading user profile…">
          <p className="text-sm text-slate-600">Loading…</p>
        </PlatformAdminShell>
      </PlatformAuthGate>
    );
  }

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title={user.displayName} subtitle={`${roleLabel(user.role)} · ${user.email}`}>
        <div className="mb-4">
          <Link href={PLATFORM_ADMIN_PAGES.users} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Back to users
          </Link>
        </div>
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className={toneCard('blue')}>
            <CardHeader className={toneCardHeader('blue')}>
              <CardTitle className={toneTitle('blue')}>Profile & access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <form className="grid gap-3" onSubmit={saveUser}>
                <Field label="Display name" value={edit.displayName} onChange={(v) => setEdit((c) => ({ ...c, displayName: v }))} />
                {auth.hasPermission('manage_users') && !user.isSystemProtected ? (
                  <>
                    <label className="space-y-1 text-sm">
                      <span className="font-medium text-slate-700">Role</span>
                      <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={edit.role} onChange={(e) => setEdit((c) => ({ ...c, role: e.target.value as PlatformRole }))}>
                        {PLATFORM_ROLES.filter((role) => auth.user?.role === 'super_admin' || role !== 'super_admin').map((role) => (
                          <option key={role} value={role}>{roleLabel(role)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="font-medium text-slate-700">Status</span>
                      <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={edit.status} onChange={(e) => setEdit((c) => ({ ...c, status: e.target.value as PlatformUserStatus }))}>
                        {PLATFORM_USER_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                    <Field label="Reset password (optional)" type="password" value={edit.password} onChange={(v) => setEdit((c) => ({ ...c, password: v }))} />
                    <Button type="submit">Save user</Button>
                  </>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Card className={toneCard('emerald')}>
            <CardHeader className={toneCardHeader('emerald')}>
              <CardTitle className={toneTitle('emerald')}>Trading engine administration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6">
              {trading ? (
                <>
                  <ToggleRow label="Trading enabled" checked={trading.tradingEnabled} onChange={(v) => void saveTrading({ tradingEnabled: v })} />
                  <ToggleRow label="Gold engine enabled" checked={trading.goldEngineEnabled} onChange={(v) => void saveTrading({ goldEngineEnabled: v })} />
                  <p className="text-xs text-slate-600">
                    Lot {trading.lotSize} · Risk {trading.riskPerTradePercent}% · Basket limit {trading.basketLimit}
                  </p>
                </>
              ) : null}
              {mt5 ? (
                <p className="text-xs text-slate-600">
                  MT5 {mt5.brokerName || '—'} · {mt5.accountNumber || 'no account'} · {mt5.connectionStatus}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className={`xl:col-span-2 ${toneCard('violet')}`}>
            <CardHeader className={toneCardHeader('violet')}>
              <CardTitle className={toneTitle('violet')}>Trading accounts → terminals → EA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              {accounts.map((account) => (
                <div key={account.id} className="rounded-lg border border-violet-200 bg-violet-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-violet-950">{account.label || account.accountNumber}</p>
                      <p className="text-xs text-violet-800">
                        {account.brokerName} · {account.serverName} · Terminal {account.terminalId ?? '—'}
                      </p>
                    </div>
                    <div className="flex gap-2 text-[11px]">
                      {account.isPrimary ? <span className={toneBadge('emerald')}>Primary</span> : null}
                      {account.tradingEnabled ? <span className={toneBadge('blue')}>Trading on</span> : null}
                      {account.goldEngineEnabled ? <span className={toneBadge('violet')}>Gold engine</span> : null}
                    </div>
                  </div>
                </div>
              ))}

              {auth.hasPermission('manage_trading_accounts') ? (
                <form className="grid gap-3 md:grid-cols-2" onSubmit={addAccount}>
                  <Field label="Label" value={accountForm.label} onChange={(v) => setAccountForm((c) => ({ ...c, label: v }))} />
                  <Field label="Account number" value={accountForm.accountNumber} onChange={(v) => setAccountForm((c) => ({ ...c, accountNumber: v }))} />
                  <Field label="Broker" value={accountForm.brokerName} onChange={(v) => setAccountForm((c) => ({ ...c, brokerName: v }))} />
                  <Field label="Server" value={accountForm.serverName} onChange={(v) => setAccountForm((c) => ({ ...c, serverName: v }))} />
                  <Field label="Terminal ID" value={accountForm.terminalId} onChange={(v) => setAccountForm((c) => ({ ...c, terminalId: v }))} />
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" checked={accountForm.isPrimary} onChange={(e) => setAccountForm((c) => ({ ...c, isPrimary: e.target.checked }))} />
                    Primary account
                  </label>
                  <div className="md:col-span-2">
                    <Button type="submit">Add trading account</Button>
                  </div>
                </form>
              ) : null}

              {eaInstances.length > 0 ? (
                <div className="text-xs text-slate-600">
                  EA instances: {eaInstances.map((ea) => `${ea.terminalId} (${ea.status})`).join(', ')}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function ToggleRow(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <span>{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}
