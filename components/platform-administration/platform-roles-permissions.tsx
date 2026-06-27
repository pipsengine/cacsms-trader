'use client';

import { FormEvent, useEffect, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { roleLabel } from '@/lib/platform-auth/rbac';
import type { PlatformPermissionKey, PlatformRole } from '@/lib/platform-auth/types';
import { PLATFORM_PERMISSION_KEYS, PLATFORM_ROLES } from '@/lib/platform-auth/types';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformRolesPermissionsPage() {
  const [users, setUsers] = useState<Array<{ id: string; displayName: string; role: PlatformRole; permissions: Partial<Record<PlatformPermissionKey, boolean>> }>>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [permissions, setPermissions] = useState<Partial<Record<PlatformPermissionKey, boolean>>>({});
  const [selectedRole, setSelectedRole] = useState<PlatformRole>('trader');
  const [roleDefaults, setRoleDefaults] = useState<Partial<Record<PlatformRole, Partial<Record<PlatformPermissionKey, boolean>>>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch('/api/platform-admin/users', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/platform-admin/role-defaults', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([usersPayload, rolesPayload]) => {
        if (!usersPayload.ok) throw new Error(usersPayload.error);
        setUsers(usersPayload.users);
        if (usersPayload.users[0]) {
          setSelectedUserId(usersPayload.users[0].id);
          setPermissions(usersPayload.users[0].permissions ?? {});
        }
        if (rolesPayload.ok) setRoleDefaults(rolesPayload.defaults ?? {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load roles.'));
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

  async function saveRoleDefaults(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/platform-admin/role-defaults', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: selectedRole, permissions: roleDefaults[selectedRole] ?? {} }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setRoleDefaults((current) => ({ ...current, [selectedRole]: payload.permissions }));
    setMessage(`Role defaults saved for ${roleLabel(selectedRole)}.`);
  }

  const selectedUser = users.find((user) => user.id === selectedUserId);

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="Roles & permissions" subtitle="Role defaults and per-user permission overrides">
        {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className={toneCard('blue')}>
            <CardHeader className={toneCardHeader('blue')}>
              <CardTitle className={toneTitle('blue')}>Role defaults</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Role</span>
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as PlatformRole)}
                >
                  {PLATFORM_ROLES.map((role) => (
                    <option key={role} value={role}>{roleLabel(role)}</option>
                  ))}
                </select>
              </label>
              <form className="grid gap-3 md:grid-cols-2" onSubmit={saveRoleDefaults}>
                {PLATFORM_PERMISSION_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(roleDefaults[selectedRole]?.[key])}
                      onChange={(e) => setRoleDefaults((current) => ({
                        ...current,
                        [selectedRole]: { ...(current[selectedRole] ?? {}), [key]: e.target.checked },
                      }))}
                    />
                    <span>{key.replaceAll('_', ' ')}</span>
                  </label>
                ))}
                <div className="md:col-span-2">
                  <Button type="submit">Save role defaults</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className={toneCard('violet')}>
            <CardHeader className={toneCardHeader('violet')}>
              <CardTitle className={toneTitle('violet')}>User overrides</CardTitle>
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
                  Base role: <strong>{roleLabel(selectedUser.role)}</strong>. Overrides apply on top of role defaults.
                </p>
              ) : null}
              <form className="grid gap-3 md:grid-cols-2" onSubmit={savePermissions}>
                {PLATFORM_PERMISSION_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(permissions[key])}
                      onChange={(e) => setPermissions((current) => ({ ...current, [key]: e.target.checked }))}
                    />
                    <span>{key.replaceAll('_', ' ')}</span>
                  </label>
                ))}
                <div className="md:col-span-2">
                  <Button type="submit">Save user overrides</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}
