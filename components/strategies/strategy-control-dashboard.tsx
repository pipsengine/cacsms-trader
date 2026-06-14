'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BrainCircuit,
  Gauge,
  Menu,
  Radio,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { DashboardPageFrame, DashboardPageScroll, DashboardPageShell } from '@/components/dashboard-page-frame';
import { StrategyRankingRow } from '@/components/strategies/strategy-ranking-row';
import { useStrategyControl } from '@/components/strategies/use-strategy-control';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  toneBadge,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneTitle,
  type DashboardTone,
} from '@/lib/dashboard-card-tones';
import { getStrategyControlModule, STRATEGY_CONTROL_MODULES } from '@/lib/strategies/strategy-control-modules';
import type { StrategyControlSlug } from '@/lib/strategies/strategy-control-modules';
import { cn } from '@/lib/utils';

function decisionTone(decision: string): DashboardTone {
  if (decision === 'buy') return 'emerald';
  if (decision === 'sell') return 'rose';
  if (decision === 'neutral') return 'slate';
  return 'amber';
}

export function StrategyControlDashboard({ moduleId }: { moduleId: StrategyControlSlug }) {
  const moduleDef = getStrategyControlModule(moduleId)!;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { loading, refreshing, error, payload, lastSyncAt } = useStrategyControl(moduleId);
  const result = payload?.result;
  const tone = moduleDef.tone;

  const metricEntries = useMemo(
    () => Object.entries(result?.metrics ?? {}).filter(([, value]) => value != null),
    [result?.metrics],
  );

  return (
    <DashboardPageFrame
      bridgeOnline={payload?.bridgeOnline ?? true}
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50"
    >
      <DashboardPageShell className="bg-slate-50">
        <header className="sticky top-0 z-20 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-md border border-slate-200 p-2 lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </button>
            <BrainCircuit className={cn('h-5 w-5', toneBody(tone))} />
            <div>
              <p className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', toneBody(tone))}>Strategy Control</p>
              <h1 className="text-lg font-semibold text-slate-900">{moduleDef.label}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>
              <Radio className={cn('h-3 w-3', !loading && !refreshing && 'animate-pulse')} />
              Autonomous
            </span>
            {payload ? (
              <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase', toneInsetSurface('cyan'), toneMuted('cyan'))}>
                {payload.symbol} · {payload.pipelineMode ?? 'full_auto'}
              </span>
            ) : null}
            <Link href="/institutional-strategy-intelligence" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Overview
            </Link>
          </div>
        </header>

        <DashboardPageScroll className="space-y-4 p-4 lg:p-6">
          {error ? (
            <div className={cn('rounded-lg border px-4 py-3 text-sm', toneInsetSurface('amber'), toneBody('amber'))}>{error}</div>
          ) : null}

          <Card className={cn('border shadow-sm', toneCard(tone))}>
            <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className={cn('text-xs font-semibold uppercase tracking-wide', toneMuted(tone))}>Control algorithm</p>
                <p className={cn('mt-1 text-sm font-medium', toneBody(tone))}>{moduleDef.algorithm}</p>
                <p className={cn('mt-2 text-xs', toneMuted(tone))}>
                  Pipeline-driven · evaluates full active book · auto-refresh every {Math.round((payload?.refreshIntervalMs ?? 15000) / 1000)}s
                  {lastSyncAt ? ` · synced ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}
                  {refreshing ? ' · updating…' : ''}
                </p>
              </div>
              {result ? (
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted(tone))}>Control decision</p>
                    <span className={cn('mt-1 inline-flex rounded-full px-3 py-1 text-sm font-semibold uppercase', toneBadge(decisionTone(result.decision)))}>
                      {result.decision}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted(tone))}>Confidence</p>
                    <p className={cn('text-2xl font-bold tabular-nums', toneMetric(tone))}>{result.confidence}%</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {result ? (
            <>
              <Card className={cn('border shadow-sm', toneCard(tone))}>
                <CardHeader className={toneCardHeader(tone)}>
                  <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle(tone))}>
                    <Sparkles className="h-4 w-4" />
                    Control summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className={cn('text-sm font-medium', toneBody(tone))}>{result.summary}</p>
                  <ul className="space-y-2">
                    {result.reasons.map((reason) => (
                      <li key={reason} className={cn('rounded-lg border px-3 py-2 text-xs', toneInsetSurface(tone), toneBody(tone))}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {metricEntries.length > 0 ? (
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {metricEntries.map(([key, value]) => (
                    <Card key={key} className={cn('border shadow-sm', toneCard(tone))}>
                      <CardContent className="p-4">
                        <p className={cn('text-[10px] font-semibold uppercase tracking-wide', toneMuted(tone))}>{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                        <p className={cn('mt-2 text-xl font-bold tabular-nums', toneMetric(tone))}>{String(value)}</p>
                      </CardContent>
                    </Card>
                  ))}
                </section>
              ) : null}

              <Card className={cn('border shadow-sm', toneCard(tone))}>
                <CardHeader className={toneCardHeader(tone)}>
                  <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle(tone))}>
                    <Gauge className="h-4 w-4" />
                    Rankings & orchestration stack
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[min(420px,50vh)] pr-3">
                    <div className="space-y-2">
                      {result.rankings.map((row, index) => (
                        <StrategyRankingRow key={`${row.id}-${index}`} row={row} tone={tone} />
                      ))}
                      {result.rankings.length === 0 ? (
                        <p className={cn('text-sm', toneMuted(tone))}>No ranking rows for this control module yet.</p>
                      ) : null}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          ) : loading ? (
            <Card className={cn('border shadow-sm', toneCard(tone))}>
              <CardContent className="flex items-center gap-3 p-6">
                <Activity className={cn('h-5 w-5 animate-pulse', toneBody(tone))} />
                <p className={cn('text-sm', toneBody(tone))}>Running strategy control module across active book…</p>
              </CardContent>
            </Card>
          ) : null}

          <Card className={cn('border shadow-sm', toneCard('slate'))}>
            <CardHeader className={toneCardHeader('slate')}>
              <CardTitle className={cn('text-base', toneTitle('slate'))}>Strategy Control modules</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {STRATEGY_CONTROL_MODULES.map((item) => (
                <Link
                  key={item.id}
                  href={`/institutional-strategy-intelligence/strategy-control/${item.id}`}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs transition hover:shadow-sm',
                    item.id === moduleId ? toneCard(item.tone) : toneInsetSurface('slate'),
                    toneBody(item.id === moduleId ? item.tone : 'slate'),
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </CardContent>
          </Card>
        </DashboardPageScroll>
      </DashboardPageShell>
    </DashboardPageFrame>
  );
}

export function StrategyControlIcon({ decision }: { decision: string }) {
  if (decision === 'buy') return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (decision === 'sell') return <TrendingDown className="h-4 w-4 text-rose-600" />;
  return null;
}
