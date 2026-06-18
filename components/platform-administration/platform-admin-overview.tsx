'use client';

import { useEffect, useState } from 'react';
import { Activity, Shield, Users, Wallet } from 'lucide-react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { PlatformAdminOverview } from '@/lib/platform-auth/types';
import { toneBadge, toneCard, toneCardHeader, toneMetric, toneTitle } from '@/lib/dashboard-card-tones';
import { roleLabel } from '@/lib/platform-auth/rbac';

export function PlatformAdminOverviewPage() {
  const [overview, setOverview] = useState<PlatformAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/platform-admin/overview', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        setOverview(payload.overview);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load overview.'));
  }, []);

  return (
    <PlatformAuthGate>
      <PlatformAdminShell
        title="Administration dashboard"
        subtitle="Users, MT5 terminals, trading engines, and platform oversight"
      >
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard tone="blue" icon={Users} label="Total users" value={overview?.totalUsers ?? '—'} />
          <MetricCard tone="emerald" icon={Activity} label="Active users" value={overview?.activeUsers ?? '—'} />
          <MetricCard tone="cyan" icon={Shield} label="MT5 connected" value={overview?.connectedMt5 ?? '—'} />
          <MetricCard tone="purple" icon={Wallet} label="Gold engines active" value={overview?.tradingEnginesActive ?? '—'} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className={toneCard('amber')}>
            <CardHeader className={toneCardHeader('amber')}>
              <CardTitle className={toneTitle('amber')}>Risk exposure</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className={`rounded-lg border p-4 text-2xl font-semibold ${toneMetric('amber')} ${toneTitle('amber')}`}>
                {overview?.riskExposure ?? 0} users trading enabled
              </div>
            </CardContent>
          </Card>
          <Card className={toneCard('rose')}>
            <CardHeader className={toneCardHeader('rose')}>
              <CardTitle className={toneTitle('rose')}>Daily P/L (aggregate)</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className={`rounded-lg border p-4 text-2xl font-semibold ${toneMetric('rose')} ${toneTitle('rose')}`}>
                {overview ? overview.dailyPnl.toFixed(2) : '—'}
              </div>
              <p className="mt-2 text-xs text-rose-800">Per-user P/L tracking connects when user-scoped engines are active.</p>
            </CardContent>
          </Card>
          <Card className={toneCard('violet')}>
            <CardHeader className={toneCardHeader('violet')}>
              <CardTitle className={toneTitle('violet')}>Active baskets</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className={`rounded-lg border p-4 text-2xl font-semibold ${toneMetric('violet')} ${toneTitle('violet')}`}>
                {overview?.activeBaskets ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className={`mt-6 ${toneCard('slate')}`}>
          <CardHeader className={toneCardHeader('slate')}>
            <CardTitle className={toneTitle('slate')}>User fleet status</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>MT5</TableHead>
                  <TableHead>Gold engine</TableHead>
                  <TableHead>Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(overview?.users ?? []).map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{user.displayName}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </TableCell>
                    <TableCell>{roleLabel(user.role)}</TableCell>
                    <TableCell>
                      <Badge className={toneBadge(user.status === 'active' ? 'emerald' : 'rose')}>{user.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={toneBadge(user.mt5Connected ? 'cyan' : 'slate')}>
                        {user.mt5Connected ? 'Connected' : 'Disconnected'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={toneBadge(user.goldEngineEnabled ? 'purple' : 'slate')}>
                        {user.goldEngineEnabled ? 'Active' : 'Stopped'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {user.accountNumber ? `${user.brokerName ?? 'Broker'} · ${user.accountNumber}` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}

function MetricCard(props: {
  tone: 'blue' | 'emerald' | 'cyan' | 'purple';
  icon: typeof Users;
  label: string;
  value: string | number;
}) {
  const Icon = props.icon;
  return (
    <Card className={toneCard(props.tone)}>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-lg border p-3 ${toneMetric(props.tone)}`}>
          <Icon className={`h-5 w-5 ${toneTitle(props.tone)}`} />
        </div>
        <div>
          <div className="text-sm text-slate-600">{props.label}</div>
          <div className={`text-2xl font-semibold ${toneTitle(props.tone)}`}>{props.value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
