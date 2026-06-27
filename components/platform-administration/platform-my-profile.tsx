'use client';

import { FormEvent, useEffect, useState } from 'react';

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
  const [mfaStatus, setMfaStatus] = useState<{ enabled: boolean } | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/platform-auth/mfa', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.ok) setMfaStatus(payload.mfa);
      })
      .catch(() => null);
  }, []);

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

  async function startMfaEnroll() {
    setError(null);
    setMessage(null);
    const response = await fetch('/api/platform-auth/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enroll' }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setMfaSecret(payload.enrollment.secret);
    setMessage('Scan the secret in your authenticator app, then verify.');
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/platform-auth/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', code: mfaCode }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setMfaStatus(payload.mfa);
    setBackupCodes(payload.mfa.backupCodes ?? []);
    setMfaSecret(null);
    setMfaCode('');
    setMessage('MFA enabled.');
  }

  async function disableMfa(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/platform-auth/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', password: disablePassword }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setMfaStatus({ enabled: false });
    setDisablePassword('');
    setBackupCodes([]);
    setMessage('MFA disabled.');
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

        <Card className={`mt-6 ${toneCard('emerald')}`}>
          <CardHeader className={toneCardHeader('emerald')}>
            <CardTitle className={toneTitle('emerald')}>Multi-factor authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-emerald-900">
              Status: <strong>{mfaStatus?.enabled ? 'Enabled' : 'Disabled'}</strong>
            </p>
            {backupCodes.length ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Backup codes (save now): {backupCodes.join(', ')}
              </div>
            ) : null}
            {!mfaStatus?.enabled ? (
              <>
                {mfaSecret ? (
                  <div className="rounded-md border border-emerald-200 bg-white p-3 font-mono text-sm">{mfaSecret}</div>
                ) : (
                  <Button type="button" onClick={() => void startMfaEnroll()}>Start MFA enrollment</Button>
                )}
                {mfaSecret ? (
                  <form className="flex flex-wrap items-end gap-3" onSubmit={verifyMfa}>
                    <label className="space-y-1 text-sm">
                      <span className="font-medium text-slate-700">Verification code</span>
                      <input className="rounded-md border border-slate-300 px-3 py-2 font-mono" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required />
                    </label>
                    <Button type="submit">Verify MFA</Button>
                  </form>
                ) : null}
              </>
            ) : (
              <form className="flex flex-wrap items-end gap-3" onSubmit={disableMfa}>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Current password</span>
                  <input className="rounded-md border border-slate-300 px-3 py-2" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
                </label>
                <Button type="submit" variant="destructive">Disable MFA</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </PlatformAdminShell>
    </PlatformAuthGate>
  );
}
