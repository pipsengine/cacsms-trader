'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Crosshair, RefreshCw } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  toneBadge,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMuted,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { cn } from '@/lib/utils';

type FeedEvent = {
  id: string;
  eventType: string;
  symbol: string | null;
  selected: boolean;
  message: string;
  reasons: string[];
  createdAt: string;
};

type FeedPayload = {
  latest: {
    selectedSymbol: string;
    selectedSymbols: string[];
    eligibleSymbols: string[];
    openPositionSymbols: string[];
    scanSummary: string;
    dailyLimitReached: boolean;
    continuousTradingEnabled?: boolean;
    dailyLimitReason?: 'daily_drawdown' | 'daily_trades' | null;
    selectedAt: string;
    session: string;
    source: string;
    candidates: Array<{
      symbol: string;
      compositeScore: number;
      tradable: boolean;
      eligibleForNewEntry: boolean;
      blocked: boolean;
      blockReason: string | null;
      rank: number;
      reasons: string[];
    }>;
  } | null;
  events: FeedEvent[];
  stale: boolean;
  nextRefreshInMs: number | null;
  generatedAt: string;
};

function eventTone(event: FeedEvent): 'emerald' | 'rose' | 'amber' | 'slate' | 'violet' {
  if (event.selected || event.eventType === 'symbol_selected') return 'emerald';
  if (event.eventType.includes('blocked') || event.eventType === 'symbol_rejected') return 'rose';
  if (event.eventType === 'symbol_filtered') return 'amber';
  if (event.eventType === 'scan_started' || event.eventType === 'scan_completed') return 'violet';
  return 'slate';
}

function formatRelativeTime(iso: string, nowMs: number): string {
  const delta = nowMs - new Date(iso).getTime();
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

export function PairSelectionLivePanel({ compact = false }: { compact?: boolean }) {
  const [feed, setFeed] = useState<FeedPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/autonomous-pipeline/pair-selection/feed?limit=30', { cache: 'no-store' });
      const payload = await response.json();
      if (payload.ok) setFeed(payload.feed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
    const feedTimer = window.setInterval(() => void loadFeed(), 8_000);
    const clockTimer = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(feedTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadFeed]);

  const latest = feed?.latest ?? null;
  const refreshProgress = feed?.nextRefreshInMs != null && feed.nextRefreshInMs >= 0
    ? Math.max(0, Math.min(100, 100 - (feed.nextRefreshInMs / (5 * 60 * 1000)) * 100))
    : 0;

  return (
    <Card className={cn('border shadow-sm', toneCard('violet'))}>
      <CardHeader className={cn('pb-3', toneCardHeader('violet'))}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-violet-600" />
            <CardTitle className={cn('text-base', toneTitle('violet'))}>Symbol selection — live audit</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {feed?.stale ? (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('amber'))}>
                Rescan due
              </span>
            ) : (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>
                Current
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void loadFeed()} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <p className={cn('text-xs', toneMuted('violet'))}>
          {latest?.scanSummary ?? 'Waiting for first autonomous pair scan.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {latest ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className={cn('rounded-lg p-2.5', toneInsetSurface('violet'))}>
              <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted('violet'))}>Primary pick</p>
              <p className={cn('text-lg font-semibold', toneBody('violet'))}>{latest.selectedSymbol}</p>
              <p className={cn('text-[11px]', toneMuted('violet'))}>
                {latest.session} · {formatRelativeTime(latest.selectedAt, clockNow)}
              </p>
            </div>
            <div className={cn('rounded-lg p-2.5', toneInsetSurface('emerald'))}>
              <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted('emerald'))}>Eligible for new entry</p>
              <p className={cn('text-sm font-medium', toneBody('emerald'))}>
                {latest.eligibleSymbols.length > 0 ? latest.eligibleSymbols.join(', ') : 'None this cycle'}
              </p>
            </div>
            <div className={cn('rounded-lg p-2.5', toneInsetSurface('blue'))}>
              <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted('blue'))}>Open / monitoring</p>
              <p className={cn('text-sm font-medium', toneBody('blue'))}>
                {latest.openPositionSymbols.length > 0 ? latest.openPositionSymbols.join(', ') : 'No open symbols'}
              </p>
            </div>
          </div>
        ) : null}

        {!compact && latest ? (
          <div>
            <p className={cn('mb-1.5 text-[10px] font-semibold uppercase tracking-wide', toneMuted('violet'))}>Candidate breakdown</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {latest.candidates.slice(0, 8).map((candidate) => (
                <div
                  key={candidate.symbol}
                  className={cn(
                    'rounded-md border px-2.5 py-2 text-xs',
                    candidate.eligibleForNewEntry
                      ? 'border-emerald-200 bg-emerald-50/70'
                      : candidate.blocked
                        ? 'border-rose-200 bg-rose-50/70'
                        : candidate.tradable
                          ? 'border-amber-200 bg-amber-50/60'
                          : 'border-slate-200 bg-slate-50/70',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{candidate.symbol}</span>
                    <span className="font-mono text-[11px] text-slate-600">{candidate.compositeScore}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    {candidate.blockReason
                      ?? (candidate.eligibleForNewEntry
                        ? 'Selected for new entry'
                        : candidate.tradable
                          ? candidate.reasons[candidate.reasons.length - 1] ?? 'Monitoring only'
                          : candidate.reasons[candidate.reasons.length - 1] ?? 'Filtered')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted('violet'))}>Recent selection events</p>
            <span className={cn('text-[10px]', toneMuted('violet'))}>Next rescan ~{Math.ceil((feed?.nextRefreshInMs ?? 0) / 60_000)}m</span>
          </div>
          <Progress value={refreshProgress} className="mb-2 h-1" />
          <ScrollArea className={cn(compact ? 'h-[180px]' : 'h-[220px]')}>
            <div className="space-y-1.5 pr-2">
              {(feed?.events ?? []).map((event) => {
                const tone = eventTone(event);
                return (
                  <div key={event.id} className={cn('rounded-md border px-2.5 py-2', toneInsetSurface(tone))}>
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn('text-xs font-medium', toneBody(tone))}>
                        {event.symbol ? `${event.symbol} — ` : ''}{event.message}
                      </p>
                      <span className={cn('shrink-0 text-[10px]', toneMuted(tone))}>
                        {formatRelativeTime(event.createdAt, clockNow)}
                      </span>
                    </div>
                    {event.reasons.length > 0 ? (
                      <p className={cn('mt-0.5 text-[11px]', toneMuted(tone))}>{event.reasons.join(' · ')}</p>
                    ) : null}
                  </div>
                );
              })}
              {(feed?.events ?? []).length === 0 ? (
                <p className={cn('text-xs', toneMuted('violet'))}>No selection events logged yet.</p>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Link
            href="/autonomous-pipeline/pair-selection-history"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-violet-700')}
          >
            View full history
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
          {latest?.dailyLimitReached ? (
            <span className={cn('text-[11px] font-medium', toneBody('rose'))}>
              {latest.dailyLimitReason === 'daily_drawdown' || latest.continuousTradingEnabled
                ? 'Daily drawdown limit reached'
                : 'Daily trade limit reached'}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
