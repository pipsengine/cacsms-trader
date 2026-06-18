'use client';

import { FormEvent, useEffect, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PlatformPermissionKey, PlatformUserPublic } from '@/lib/platform-auth/types';
import { PLATFORM_PERMISSION_KEYS } from '@/lib/platform-auth/types';
import { roleLabel } from '@/lib/platform-auth/rbac';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformRolesPermissionsPage() {
  const [users, setUsers] = useState<PlatformUserPublic[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [permissions, setPermissions] = useState<Partial<Record<PlatformPermissionKey, boolean>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/platform-admin/users', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        setUsers(payload.users);
        if (payload.users[0]) {
          setSelectedUserId(payload.users[0].id);
          setPermissions(payload.users[0].permissions ?? {});
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users.'));
  }, []);

  useEffect(() => {
    const user = users.find((item) => item.id === selectedUserId);
    if (user) setPermissions(user.permissions ?? {});
  }, [selectedUserId, users]);

  async function savePermissions(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/platform-admin/users/${selectedUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setMessage('Permission overrides saved.');
    setUsers((current) => current.map((user) => (user.id === selectedUserId ? payload.user : user)));
  }

  const selectedUser = users.find((user) => user.id === selectedUserId);

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="Roles & permissions" subtitle="Role-based access control with per-user module toggles">
        {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        <Card className={toneCard('violet')}>
          <CardHeader className={toneCardHeader('violet')}>
            <CardTitle className={toneTitle('violet')}>Permission matrix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">User</span>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} ({roleLabel(user.role)})
                  </option>
                ))}
              </select>
            </label>

            {selectedUser ? (
              <p className="text-sm text-violet-900">
                Base role: <strong>{roleLabel(selectedUser.role)}</strong>. Toggle overrides below apply on top of role defaults.
              </p>
            ) : null}

            <form className="grid gap-3 md:grid-cols-2" onSubmit={savePermissions}>
              {PLATFORM_PERMISSION_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                  <input
                    type="checkbox"
                    checked={Boolean(permissions[key])}
                    onChange={(e) => setPermissions((current) => ({ ...current, [key]: e.target.checked }))}
                  />
                  <span>{key.replaceAll('_', ' ')}</span>
                </label>
              ))}
              <div className="md:col-span-2">
                <Button type="submit">Save permissions</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}
