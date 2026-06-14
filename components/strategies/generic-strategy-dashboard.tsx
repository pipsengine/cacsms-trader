'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BrainCircuit,
  Menu,
  Radio,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { DashboardPageFrame, DashboardPageScroll, DashboardPageShell } from '@/components/dashboard-page-frame';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAutonomousStrategyEvaluation } from '@/components/strategies/use-autonomous-strategy-evaluation';
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
import { getGroupMeta } from '@/lib/strategies/registry';
import type { StrategyDefinition } from '@/lib/strategies/types';
import { cn } from '@/lib/utils';

function decisionTone(decision: string): DashboardTone {
  if (decision === 'buy') return 'emerald';
  if (decision === 'sell') return 'rose';
  return 'amber';
}

function biasIcon(bias: string) {
  if (bias === 'bullish') return <TrendingUp className="h-5 w-5 text-emerald-600" />;
  if (bias === 'bearish') return <TrendingDown className="h-5 w-5 text-rose-600" />;
  return null;
}

export function GenericStrategyDashboard(props: { definition: StrategyDefinition }) {
  const { definition } = props;
  const groupMeta = getGroupMeta(definition.group);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const {
    loading,
    refreshing,
    error,
    result,
    capturedAt,
    lastSyncAt,
    context,
  } = useAutonomousStrategyEvaluation(definition.id);

  const metricEntries = useMemo(
    () => Object.entries(result?.metrics ?? {}).filter(([, value]) => value != null),
    [result],
  );

  const configEntries = useMemo(
    () => Object.entries(result?.config ?? {}).filter(([key]) => key !== 'autonomous' && key !== 'symbol' && key !== 'timeframe'),
    [result?.config],
  );

  const headerTone = groupMeta?.tone ?? definition.tone;

  return (
    <DashboardPageFrame
      bridgeOnline={context?.bridgeOnline ?? true}
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
            <div>
              <p className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', toneBody(headerTone))}>
                {groupMeta?.label ?? definition.group.replace(/-/g, ' ')}
              </p>
              <h1 className="text-lg font-semibold text-slate-900">{definition.label}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>
              <Radio className={cn('h-3 w-3', !loading && !refreshing && 'animate-pulse')} />
              Autonomous
            </span>
            {context ? (
              <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase', toneInsetSurface('cyan'), toneMuted('cyan'))}>
                {context.symbol} · {context.timeframe} · {context.pipelineMode ?? 'full_auto'}
              </span>
            ) : null}
            <Link href="/institutional-strategy-intelligence" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Overview
            </Link>
          </div>
        </header>

        <DashboardPageScroll className="space-y-4 p-4 lg:p-6">
          <Card className={cn('border shadow-sm', toneCard(definition.tone))}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className={cn('text-xs font-semibold uppercase tracking-wide', toneMuted(definition.tone))}>Institutional algorithm</p>
                <p className={cn('mt-1 text-sm font-medium', toneBody(definition.tone))}>{definition.algorithm}</p>
                <p className={cn('mt-2 text-xs', toneMuted(definition.tone))}>
                  Pipeline-driven symbol/timeframe · auto-refresh every {Math.round((context?.refreshIntervalMs ?? 15000) / 1000)}s
                  {lastSyncAt ? ` · synced ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}
                  {refreshing ? ' · updating…' : ''}
                </p>
              </div>
              <span className={cn('inline-flex w-fit rounded-full px-3 py-1 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>
                {loading ? 'initializing' : 'live'}
              </span>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card className={cn('border shadow-sm', toneCard(headerTone))}>
              <CardHeader className={cn('pb-3', toneCardHeader(headerTone))}>
                <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle(headerTone))}>
                  <Sparkles className="h-4 w-4" />
                  Autonomous configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {configEntries.map(([key, value]) => (
                  <div key={key} className={cn('rounded-lg border px-3 py-2', toneInsetSurface(headerTone))}>
                    <p className={cn('text-[11px] uppercase tracking-wide', toneMuted(headerTone))}>{key.replace(/([A-Z])/g, ' $1')}</p>
                    <p className="mt-1 font-semibold text-slate-900">{String(value)}</p>
                  </div>
                ))}
                {context?.activeSymbols?.length ? (
                  <div className={cn('rounded-lg border px-3 py-2', toneInsetSurface(headerTone))}>
                    <p className={cn('text-[11px] uppercase tracking-wide', toneMuted(headerTone))}>Pipeline universe</p>
                    <p className="mt-1 text-xs text-slate-700">{context.activeSymbols.slice(0, 8).join(', ')}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Card className={cn('border shadow-sm', toneCard(decisionTone(result?.decision ?? 'wait')))}>
                  <CardContent className="pt-6">
                    <p className={cn('text-xs uppercase tracking-wide', toneMuted(decisionTone(result?.decision ?? 'wait')))}>Signal</p>
                    <p className={cn('mt-2 text-2xl font-semibold uppercase', toneMetric(decisionTone(result?.decision ?? 'wait')))}>
                      {loading ? '…' : result?.decision ?? 'wait'}
                    </p>
                  </CardContent>
                </Card>
                <Card className={cn('border shadow-sm', toneCard('cyan'))}>
                  <CardContent className="pt-6">
                    <p className={cn('text-xs uppercase tracking-wide', toneMuted('cyan'))}>Confidence</p>
                    <p className={cn('mt-2 text-2xl font-semibold', toneMetric('cyan'))}>{result?.confidence ?? 0}%</p>
                  </CardContent>
                </Card>
                <Card className={cn('border shadow-sm', toneCard(result?.bias === 'bullish' ? 'emerald' : result?.bias === 'bearish' ? 'rose' : 'amber'))}>
                  <CardContent className="pt-6">
                    <p className={cn('text-xs uppercase tracking-wide', toneMuted('slate'))}>Bias</p>
                    <p className="mt-2 flex items-center gap-2 text-2xl font-semibold capitalize">
                      {biasIcon(result?.bias ?? 'neutral')}
                      {result?.bias ?? 'neutral'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className={cn('border shadow-sm', toneCard('slate'))}>
                <CardHeader className={cn('pb-3', toneCardHeader('slate'))}>
                  <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle('slate'))}>
                    <Activity className="h-4 w-4" />
                    Evaluation output
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {error ? (
                    <div className={cn('rounded-lg border px-4 py-3 text-sm', toneInsetSurface('amber'), toneBody('amber'))}>{error}</div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {metricEntries.map(([key, value]) => (
                      <Metric key={key} label={key.replace(/([A-Z])/g, ' $1')} value={String(value)} />
                    ))}
                    <Metric label="Candles" value={String(result?.candleCount ?? 0)} />
                  </div>
                  <div className="space-y-2">
                    {(result?.reasons ?? ['Awaiting autonomous evaluation from pipeline capture data.']).map((reason) => (
                      <p key={reason} className={cn('text-sm', toneBody('slate'))}>• {reason}</p>
                    ))}
                  </div>
                  {capturedAt ? (
                    <p className={cn('text-xs', toneMuted('slate'))}>Latest capture: {new Date(capturedAt).toLocaleString()}</p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className={cn('border shadow-sm', toneCard('purple'))}>
              <CardHeader className={cn('pb-3', toneCardHeader('purple'))}>
                <CardTitle className={cn('text-base', toneTitle('purple'))}>Recent events</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-56 pr-3">
                  <div className="space-y-2">
                    {(result?.events ?? []).length === 0 ? (
                      <p className={cn('text-sm', toneMuted('purple'))}>No discrete events on the latest evaluation bar.</p>
                    ) : result?.events.map((event, index) => (
                      <div key={`${event.label}-${index}`} className={cn('rounded-lg border px-3 py-2', toneInsetSurface(event.tone))}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium capitalize">{event.label}</span>
                          {event.barIndex != null ? (
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(event.tone))}>
                              bar {event.barIndex}
                            </span>
                          ) : null}
                        </div>
                        <p className={cn('mt-1 text-xs', toneMuted('slate'))}>{event.detail}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className={cn('border shadow-sm', toneCard(definition.tone))}>
              <CardHeader className={cn('pb-3', toneCardHeader(definition.tone))}>
                <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle(definition.tone))}>
                  <BrainCircuit className="h-4 w-4" />
                  Strategy rules
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {definition.rules.map((rule) => (
                  <div key={rule} className={cn('rounded-lg border px-3 py-2', toneInsetSurface(definition.tone))}>
                    <p className={toneBody(definition.tone)}>{rule}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </DashboardPageScroll>
      </DashboardPageShell>
    </DashboardPageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', toneInsetSurface('slate'))}>
      <p className={cn('text-[11px] uppercase tracking-wide', toneMuted('slate'))}>{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}
