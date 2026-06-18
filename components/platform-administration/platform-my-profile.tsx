'use client';

import { FormEvent, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { roleLabel } from '@/lib/platform-auth/rbac';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformMyProfilePage() {
  const auth = usePlatformAuth();
  const [displayName, setDisplayName] = useState(auth.user?.displayName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!auth.user) return;
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/platform-admin/users/${auth.user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setMessage('Profile updated.');
    await auth.refresh();
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/platform-auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setMessage('Password changed successfully.');
  }

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="My profile" subtitle="Account details and password management">
        {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className={toneCard('blue')}>
            <CardHeader className={toneCardHeader('blue')}>
              <CardTitle className={toneTitle('blue')}>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                <div><strong>Email:</strong> {auth.user?.email}</div>
                <div><strong>Role:</strong> {auth.user ? roleLabel(auth.user.role) : '—'}</div>
                <div><strong>Status:</strong> {auth.user?.status}</div>
              </div>
              <form className="space-y-4" onSubmit={saveProfile}>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Display name</span>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </label>
                <Button type="submit">Save profile</Button>
              </form>
            </CardContent>
          </Card>

          <Card className={toneCard('amber')}>
            <CardHeader className={toneCardHeader('amber')}>
              <CardTitle className={toneTitle('amber')}>Change password</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form className="space-y-4" onSubmit={changePassword}>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Current password</span>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">New password</span>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <Button type="submit">Update password</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}
