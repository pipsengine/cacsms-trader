'use client';

import { useEffect, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PlatformAuditEntry } from '@/lib/platform-auth/types';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformAuditLogPage() {
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/platform-admin/audit-log?limit=200', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error);
        setEntries(payload.entries);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load audit log.'));
  }, []);

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="Audit log" subtitle="Login, MT5, settings, trading, and admin activity">
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}
        <Card className={toneCard('slate')}>
          <CardHeader className={toneCardHeader('slate')}>
            <CardTitle className={toneTitle('slate')}>Recent events</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-slate-600">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{entry.category}</TableCell>
                    <TableCell>{entry.action}</TableCell>
                    <TableCell className="text-sm">{entry.actorEmail ?? '—'}</TableCell>
                    <TableCell className="text-sm">{entry.targetEmail ?? '—'}</TableCell>
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
