'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Crosshair, Menu, RefreshCw } from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type HistoryEvent = {
  id: string;
  eventType: string;
  symbol: string | null;
  selected: boolean;
  message: string;
  reasons: string[];
  createdAt: string;
};

type HistorySelection = {
  id: string;
  selectedSymbol: string;
  selectedSymbols: string[];
  session: string;
  source: string;
  compositeScore: number | null;
  createdAt: string;
};

export default function PairSelectionHistoryPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [selections, setSelections] = useState<HistorySelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/autonomous-pipeline/pair-selection/history?limit=100', { cache: 'no-store' });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to load history');
      setEvents(payload.history.events ?? []);
      setSelections(payload.history.selections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <TraderSidebar bridgeOnline={false} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />
      <main className="flex-1 overflow-hidden">
        <header className="flex items-center justify-between border-b bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Crosshair className="h-5 w-5 text-violet-600" />
              <div>
                <h1 className="text-lg font-semibold text-slate-900">Pair selection history</h1>
                <p className="text-xs text-slate-500">Audit trail of symbol scans, selections, blocks, and rejections</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/autonomous-pipeline">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Pipeline
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => void loadHistory()} disabled={loading}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </header>

        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Selection events</CardTitle>
            </CardHeader>
            <CardContent>
              {error ? <p className="text-sm text-rose-600">{error}</p> : null}
              <ScrollArea className="h-[70vh]">
                <div className="space-y-2 pr-3">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        'rounded-md border px-3 py-2 text-sm',
                        event.selected ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          <span className="font-mono text-[11px] uppercase text-slate-500">{event.eventType}</span>
                          {' · '}
                          {event.symbol ? `${event.symbol} — ` : ''}{event.message}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {event.reasons.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-600">{event.reasons.join(' · ')}</p>
                      ) : null}
                    </div>
                  ))}
                  {events.length === 0 && !loading ? (
                    <p className="text-sm text-slate-500">No events recorded yet. Run an autonomous pair scan from the pipeline page.</p>
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved selections</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[70vh]">
                <div className="space-y-2 pr-3">
                  {selections.map((selection) => (
                    <div key={selection.id} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900">{selection.selectedSymbol}</p>
                        <span className="text-[11px] text-slate-500">{new Date(selection.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        Symbols: {selection.selectedSymbols.join(', ') || selection.selectedSymbol}
                      </p>
                      <p className="text-xs text-slate-500">
                        {selection.session} · {selection.source}
                        {selection.compositeScore != null ? ` · score ${selection.compositeScore}` : ''}
                      </p>
                    </div>
                  ))}
                  {selections.length === 0 && !loading ? (
                    <p className="text-sm text-slate-500">No saved selections yet.</p>
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
