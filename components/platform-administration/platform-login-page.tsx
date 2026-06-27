'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { PlatformAuthLayout } from '@/components/platform-administration/platform-auth-layout';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';

export function PlatformLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = usePlatformAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    if (!auth.loaded || !auth.authenticated) return;
    const redirect = searchParams.get('redirect') ?? PLATFORM_ADMIN_PAGES.overview;
    router.replace(redirect);
  }, [auth.loaded, auth.authenticated, router, searchParams]);

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
      if (payload.mfaRequired && payload.mfaToken) {
        setMfaToken(payload.mfaToken);
        return;
      }
      await auth.refresh();
      const redirect = searchParams.get('redirect') ?? PLATFORM_ADMIN_PAGES.overview;
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(event: FormEvent) {
    event.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-auth/verify-mfa-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code: mfaCode }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'MFA verification failed.');
      await auth.refresh();
      const redirect = searchParams.get('redirect') ?? PLATFORM_ADMIN_PAGES.overview;
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed.');
    } finally {
      setLoading(false);
    }
  }

  if (auth.loaded && auth.authenticated) {
    return (
      <PlatformAuthLayout title="Platform sign in" subtitle="Redirecting to your dashboard…">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          Session active. Redirecting…
        </div>
      </PlatformAuthLayout>
    );
  }

  return (
    <PlatformAuthLayout
      title="Platform sign in"
      subtitle="Secure access to user management and per-user MT5 trading controls"
    >
      <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card className={toneCard('violet')}>
          <CardHeader className={toneCardHeader('violet')}>
            <CardTitle className={toneTitle('violet')}>{mfaToken ? 'Verify MFA' : 'Sign in'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {mfaToken ? (
              <form className="space-y-4" onSubmit={handleMfaVerify}>
                <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator app.</p>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Authentication code</span>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </label>
                {error ? <p className="text-sm text-rose-700">{error}</p> : null}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Verifying…' : 'Verify and sign in'}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => { setMfaToken(null); setMfaCode(''); }}>
                  Back
                </Button>
              </form>
            ) : (
              <>
            <form className="space-y-4" onSubmit={handleLogin}>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Email</span>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@company.com"
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
                  autoComplete="current-password"
                  required
                />
              </label>
              {error ? <p className="text-sm text-rose-700">{error}</p> : null}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            <Link
              className="block text-center text-sm text-slate-600 underline"
              href="/forgot-password"
            >
              Forgot password?
            </Link>
              </>
            )}
          </CardContent>
        </Card>

        <Card className={toneCard('slate')}>
          <CardHeader className={toneCardHeader('slate')}>
            <CardTitle className={toneTitle('slate')}>Multi-user platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6 text-sm text-slate-700">
            <p>
              Each user operates an isolated trading engine with their own MT5 terminal, risk settings, and audit
              trail.
            </p>
            <p>
              Super Administrators manage all users. Administrators manage assigned traders. Viewers have read-only
              oversight.
            </p>
            <p className="rounded-md border border-slate-200 bg-white/80 p-3 text-xs text-slate-600">
              Contact your platform administrator if you need an account or password reset.
            </p>
          </CardContent>
        </Card>
      </div>
    </PlatformAuthLayout>
  );
}
