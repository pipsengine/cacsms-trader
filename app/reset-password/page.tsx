'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/platform-auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Password reset failed.');
      setSuccess(payload.message ?? 'Password reset successfully.');
      setTimeout(() => router.push(PLATFORM_ADMIN_PAGES.login), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <Card className={`w-full max-w-md ${toneCard('amber')}`}>
        <CardHeader className={toneCardHeader('amber')}>
          <CardTitle className={toneTitle('amber')}>Reset password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Reset token</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
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
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}
            {success ? <p className="text-sm text-emerald-800">{success}</p> : null}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Updating…' : 'Update password'}
            </Button>
          </form>
          <Link className="block text-center text-sm text-slate-600 underline" href={PLATFORM_ADMIN_PAGES.login}>
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-600">Loading…</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
