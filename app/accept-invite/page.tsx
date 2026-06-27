'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

import { PlatformAuthLayout } from '@/components/platform-administration/platform-auth-layout';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = usePlatformAuth();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/platform-auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to accept invitation.');
      await auth.refresh();
      router.push(PLATFORM_ADMIN_PAGES.overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to accept invitation.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PlatformAuthLayout title="Accept invitation" subtitle="Create your platform password">
      <Card className={`mx-auto max-w-md ${toneCard('violet')}`}>
        <CardHeader className={toneCardHeader('violet')}>
          <CardTitle className={toneTitle('violet')}>Set up your account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Invitation token</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
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
                minLength={8}
                required
              />
            </label>
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creating account…' : 'Accept invitation'}
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

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-600">Loading…</div>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
