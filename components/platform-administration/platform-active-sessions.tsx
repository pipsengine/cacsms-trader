'use client';

import { useEffect, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PlatformSessionView } from '@/lib/platform-auth/types';
import { formatDisplayTimestamp } from '@/lib/format-client-time';
import { toneBadge, toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformActiveSessionsPage() {
  const auth = usePlatformAuth();
  const [sessions, setSessions] = useState<PlatformSessionView[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadSessions() {
    const response = await fetch('/api/platform-admin/sessions', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error);
    setSessions(payload.sessions);
  }

  useEffect(() => {
    if (!auth.hasPermission('manage_active_sessions')) return;
    void loadSessions().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions.'));
  }, [auth]);

  async function revokeSession(sessionId: string) {
    const response = await fetch('/api/platform-admin/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    await loadSessions();
  }

  if (!auth.hasPermission('manage_active_sessions')) {
    return (
      <PlatformAuthGate>
        <PlatformAdminShell title="Active sessions" subtitle="Session monitoring">
          <p className="text-sm text-rose-700">You do not have permission to manage active sessions.</p>
        </PlatformAdminShell>
      </PlatformAuthGate>
    );
  }

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="Active sessions" subtitle="Monitor platform sessions and force logout">
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}
        <Card className={toneCard('slate')}>
          <CardHeader className={toneCardHeader('slate')}>
            <CardTitle className={toneTitle('slate')}>Live sessions ({sessions.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>IP / Agent</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="font-medium">{session.userDisplayName}</div>
                      <div className="text-xs text-slate-500">{session.userEmail}</div>
                      {session.isCurrent ? (
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneBadge('emerald')}`}>
                          Current session
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-slate-600">
                      <div>{session.ipAddress ?? '—'}</div>
                      <div className="truncate text-slate-400">{session.userAgent ?? '—'}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{formatDisplayTimestamp(session.createdAt)}</TableCell>
                    <TableCell className="text-xs text-slate-600">{formatDisplayTimestamp(session.expiresAt)}</TableCell>
                    <TableCell>
                      {!session.isCurrent ? (
                        <Button size="sm" variant="outline" onClick={() => void revokeSession(session.id)}>
                          Force logout
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
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
