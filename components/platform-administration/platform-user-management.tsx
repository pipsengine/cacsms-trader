'use client';

import { FormEvent, useEffect, useState } from 'react';

import Link from 'next/link';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { platformAdminUserDetail } from '@/lib/platform-admin-routes';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { PlatformRole, PlatformUserPublic, PlatformUserStatus } from '@/lib/platform-auth/types';
import { PLATFORM_ROLES, PLATFORM_USER_STATUSES } from '@/lib/platform-auth/types';
import { roleLabel } from '@/lib/platform-auth/rbac';
import { toneBadge, toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformUserManagementPage() {
  const auth = usePlatformAuth();
  const [users, setUsers] = useState<PlatformUserPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    password: '',
    role: 'trader' as PlatformRole,
    status: 'active' as PlatformUserStatus,
  });

  async function loadUsers() {
    const response = await fetch('/api/platform-admin/users', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error);
    setUsers(payload.users);
  }

  useEffect(() => {
    void loadUsers().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users.'));
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/platform-admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setForm({ email: '', displayName: '', password: '', role: 'trader', status: 'active' });
    await loadUsers();
  }

  async function updateStatus(user: PlatformUserPublic, status: PlatformUserStatus) {
    const response = await fetch(`/api/platform-admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    await loadUsers();
  }

  async function deleteUser(user: PlatformUserPublic) {
    if (!window.confirm(`Delete ${user.displayName}? This cannot be undone.`)) return;
    const response = await fetch(`/api/platform-admin/users/${user.id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    await loadUsers();
  }

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="User management" subtitle="Create, suspend, disable, and assign platform users">
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        {auth.hasPermission('manage_users') ? (
          <Card className={`mb-6 ${toneCard('blue')}`}>
            <CardHeader className={toneCardHeader('blue')}>
              <CardTitle className={toneTitle('blue')}>Create user</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreate}>
                <Field label="Email" value={form.email} onChange={(v) => setForm((c) => ({ ...c, email: v }))} />
                <Field label="Display name" value={form.displayName} onChange={(v) => setForm((c) => ({ ...c, displayName: v }))} />
                <Field label="Password" type="password" value={form.password} onChange={(v) => setForm((c) => ({ ...c, password: v }))} />
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Role</span>
                  <select
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    value={form.role}
                    onChange={(e) => setForm((c) => ({ ...c, role: e.target.value as PlatformRole }))}
                  >
                    {PLATFORM_ROLES.filter((role) => auth.user?.role === 'super_admin' || role !== 'super_admin').map((role) => (
                      <option key={role} value={role}>{roleLabel(role)}</option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-2">
                  <Button type="submit">Create user</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card className={toneCard('slate')}>
          <CardHeader className={toneCardHeader('slate')}>
            <CardTitle className={toneTitle('slate')}>Users</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.displayName}</div>
                      <div className="text-xs text-slate-500">
                        {user.username ? `@${user.username}` : null}
                        {user.username && user.email ? ' · ' : null}
                        {user.email}
                      </div>
                      {user.isSystemProtected ? (
                        <div className="mt-1 text-[11px] font-medium text-indigo-700">Global Super Administrator (protected)</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{roleLabel(user.role)}</TableCell>
                    <TableCell>
                      <Badge className={toneBadge(user.status === 'active' ? 'emerald' : 'rose')}>{user.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</TableCell>
                    <TableCell className="space-x-2">
                      <Link href={platformAdminUserDetail(user.id)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                        Manage
                      </Link>
                      {auth.hasPermission('manage_users') && !user.isSystemProtected
                        ? PLATFORM_USER_STATUSES.filter((s) => s !== user.status).map((status) => (
                            <Button key={status} size="sm" variant="outline" onClick={() => void updateStatus(user, status)}>
                              {status}
                            </Button>
                          ))
                        : user.isSystemProtected
                          ? <span className="text-xs text-slate-500">Protected</span>
                          : '—'}
                      {auth.hasPermission('manage_users') && !user.isSystemProtected ? (
                        <Button size="sm" variant="destructive" onClick={() => void deleteUser(user)}>
                          Delete
                        </Button>
                      ) : null}
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

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700">{props.label}</span>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required
      />
    </label>
  );
}
