'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { PlatformAdminShell } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = usePlatformAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Sign in failed.');
      await auth.refresh();
      const redirect = searchParams.get('redirect') ?? '/platform-administration';
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetRequest() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Reset request failed.');
      if (payload.resetToken) setResetToken(payload.resetToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset request failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetComplete(event: FormEvent) {
    event.preventDefault();
    if (!resetToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Password reset failed.');
      setResetToken(null);
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PlatformAdminShell
      title="Platform sign in"
      subtitle="Secure access to user management and per-user MT5 trading controls"
    >
      <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card className={toneCard('violet')}>
          <CardHeader className={toneCardHeader('violet')}>
            <CardTitle className={toneTitle('violet')}>Sign in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <form className="space-y-4" onSubmit={handleLogin}>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Email</span>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="admin@cacsms.com"
                  required
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Password</span>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {error ? <p className="text-sm text-rose-700">{error}</p> : null}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            <Button type="button" variant="outline" className="w-full" disabled={loading || !email} onClick={handleResetRequest}>
              Request password reset
            </Button>
            <Link className="block text-center text-sm text-slate-600 underline" href="/forgot-password">
              Forgot password page
            </Link>
          </CardContent>
        </Card>

        {resetToken ? (
          <Card className={toneCard('amber')}>
            <CardHeader className={toneCardHeader('amber')}>
              <CardTitle className={toneTitle('amber')}>Complete password reset</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-amber-900">
                Development reset token issued. In production, this would be emailed to the user.
              </p>
              <form className="space-y-4" onSubmit={handleResetComplete}>
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
                <Button type="submit" disabled={loading} className="w-full">
                  Reset password
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className={toneCard('slate')}>
            <CardHeader className={toneCardHeader('slate')}>
              <CardTitle className={toneTitle('slate')}>Multi-user platform</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6 text-sm text-slate-700">
              <p>Each user operates an isolated Gold trading engine with their own MT5 terminal, risk settings, and audit trail.</p>
              <p>Super Administrators manage all users. Administrators manage assigned traders. Viewers have read-only oversight.</p>
              <p className="rounded-md border border-slate-200 bg-white/80 p-3 text-xs text-slate-600">
                Global Super Administrator: <strong>admin@cacsms.com</strong> — password set at bootstrap. This account cannot be deleted.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </PlatformAdminShell>
  );
}
