'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

import { PlatformAuthLayout } from '@/components/platform-administration/platform-auth-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setDevToken(null);
    try {
      const response = await fetch('/api/platform-auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Reset request failed.');
      setMessage(payload.message ?? 'If the account exists, a reset link has been issued.');
      if (payload.resetToken) setDevToken(payload.resetToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset request failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PlatformAuthLayout title="Forgot password" subtitle="Request a password reset link">
      <Card className={`mx-auto w-full max-w-md ${toneCard('violet')}`}>
        <CardHeader className={toneCardHeader('violet')}>
          <CardTitle className={toneTitle('violet')}>Forgot password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Email</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}
            {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
            {devToken ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Development token:{' '}
                <Link className="font-medium underline" href={`/reset-password?token=${encodeURIComponent(devToken)}`}>
                  use reset link
                </Link>
              </p>
            ) : null}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
          <Link className="block text-center text-sm text-slate-600 underline" href={PLATFORM_ADMIN_PAGES.login}>
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </PlatformAuthLayout>
  );
}
