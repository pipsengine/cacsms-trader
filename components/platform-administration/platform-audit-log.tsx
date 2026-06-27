'use client';

import { useEffect, useMemo, useState } from 'react';

import { PlatformAdminShell, PlatformAuthGate } from '@/components/platform-administration/platform-admin-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PlatformAuditEntry } from '@/lib/platform-auth/types';
import { toneCard, toneCardHeader, toneTitle } from '@/lib/dashboard-card-tones';

export function PlatformAuditLogPage() {
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [category, setCategory] = useState('');
  const [since, setSince] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const categories = useMemo(
    () => [...new Set(entries.map((entry) => entry.category))].sort(),
    [entries],
  );

  async function loadEntries() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '200' });
    if (category) params.set('category', category);
    if (since) params.set('since', new Date(since).toISOString());
    try {
      const response = await fetch(`/api/platform-admin/audit-log?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error);
      setEntries(payload.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  return (
    <PlatformAuthGate>
      <PlatformAdminShell title="Audit log" subtitle="Login, MT5, settings, trading, and admin activity">
        {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}
        <Card className={`mb-4 ${toneCard('slate')}`}>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Category</span>
              <select className="rounded-md border border-slate-300 px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All</option>
                {categories.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Since</span>
              <input className="rounded-md border border-slate-300 px-3 py-2" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />
            </label>
            <Button type="button" variant="outline" disabled={loading} onClick={() => void loadEntries()}>
              {loading ? 'Loading…' : 'Apply filters'}
            </Button>
          </CardContent>
        </Card>
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
                  <TableHead>IP</TableHead>
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
                    <TableCell className="text-sm font-mono text-xs">{entry.ipAddress ?? '—'}</TableCell>
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
