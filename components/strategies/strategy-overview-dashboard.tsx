'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BrainCircuit, Menu, Radio, Sparkles } from 'lucide-react';

import { DashboardPageFrame, DashboardPageScroll, DashboardPageShell } from '@/components/dashboard-page-frame';
import { useAutonomousStrategyOverview } from '@/components/strategies/use-autonomous-strategy-overview';
import { useModuleSummaries } from '@/components/strategies/use-module-summaries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  ACTIVE_STRATEGIES,
  STRATEGY_DEFINITIONS,
  STRATEGY_GROUP_META,
  listStrategiesByGroup,
} from '@/lib/strategies/registry';
import { STRATEGY_CONTROL_MODULES } from '@/lib/strategies/strategy-control-modules';
import { RESEARCH_EVOLUTION_MODULES } from '@/lib/strategies/research-evolution-modules';
import { cn } from '@/lib/utils';

function decisionTone(decision: string): DashboardTone {
  if (decision === 'buy') return 'emerald';
  if (decision === 'sell') return 'rose';
  return 'amber';
}

export function StrategyOverviewDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const {
    loading,
    refreshing,
    error,
    symbol,
    pipelineMode,
    activeSymbols,
    bridgeOnline,
    lastSyncAt,
    strategies: liveEvaluations,
  } = useAutonomousStrategyOverview();
  const {
    loading: modulesLoading,
    refreshing: modulesRefreshing,
    payload: moduleSummaries,
  } = useModuleSummaries();

  const controlSummaryById = useMemo(
    () => new Map(moduleSummaries?.control.map((item) => [item.id, item]) ?? []),
    [moduleSummaries?.control],
  );
  const researchSummaryById = useMemo(
    () => new Map(moduleSummaries?.research.map((item) => [item.id, item]) ?? []),
    [moduleSummaries?.research],
  );

  const evaluationById = useMemo(
    () => new Map(liveEvaluations.map((item) => [item.id, item])),
    [liveEvaluations],
  );

  const plannedTotal = useMemo(
    () => STRATEGY_DEFINITIONS.filter((item) => item.status === 'planned').length,
    [],
  );

  const signalSummary = useMemo(() => {
    const buy = liveEvaluations.filter((item) => item.decision === 'buy' && !item.error).length;
    const sell = liveEvaluations.filter((item) => item.decision === 'sell' && !item.error).length;
    const wait = liveEvaluations.filter((item) => item.decision === 'wait' && !item.error).length;
    return { buy, sell, wait };
  }, [liveEvaluations]);

  return (
    <DashboardPageFrame
      bridgeOnline={bridgeOnline}
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
            <BrainCircuit className="h-5 w-5 text-violet-600" />
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Institutional Strategy Intelligence</h1>
              <p className="text-xs text-slate-500">Pipeline-driven · autonomous evaluation · no manual input</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>
              <Radio className={cn('h-3 w-3', !loading && !refreshing && 'animate-pulse')} />
              Autonomous
            </span>
            {symbol ? (
              <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase', toneInsetSurface('cyan'), toneMuted('cyan'))}>
                {symbol} · {pipelineMode ?? 'full_auto'}
              </span>
            ) : null}
            {lastSyncAt ? (
              <span className="text-[10px] text-slate-500">
                synced {new Date(lastSyncAt).toLocaleTimeString()}
                {refreshing || modulesRefreshing ? ' · updating…' : ''}
              </span>
            ) : null}
          </div>
        </header>

        <DashboardPageScroll className="space-y-4 p-4 lg:p-6">
          {error ? (
            <div className={cn('rounded-lg border px-4 py-3 text-sm', toneInsetSurface('amber'), toneBody('amber'))}>{error}</div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-4">
            <StatCard tone="violet" label="Active engines" value={String(ACTIVE_STRATEGIES.length)} detail="Live autonomous evaluation" />
            <StatCard tone="emerald" label="Buy signals" value={loading ? '…' : String(signalSummary.buy)} detail="Across active engines" />
            <StatCard tone="rose" label="Sell signals" value={loading ? '…' : String(signalSummary.sell)} detail="Across active engines" />
            <StatCard tone="amber" label="Wait / neutral" value={loading ? '…' : String(signalSummary.wait)} detail={`${plannedTotal} strategies queued`} />
          </section>

          <Card className={cn('border shadow-sm', toneCard('violet'))}>
            <CardHeader className={toneCardHeader('violet')}>
              <CardTitle className={cn('flex items-center gap-2', toneTitle('violet'))}>
                <Sparkles className="h-4 w-4" />
                Deployed strategy modules
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ACTIVE_STRATEGIES.map((strategy) => {
                const evaluation = evaluationById.get(strategy.id);
                const tone = evaluation?.error ? 'amber' : decisionTone(evaluation?.decision ?? 'wait');
                return (
                  <Link
                    key={strategy.id}
                    href={`/institutional-strategy-intelligence/${strategy.group}/${strategy.id}`}
                    className={cn('block rounded-xl border p-4 transition hover:shadow-md', toneCard(strategy.tone))}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{strategy.label}</p>
                        <p className={cn('mt-1 text-xs uppercase tracking-wide', toneMuted(strategy.tone))}>
                          {getGroupLabel(strategy.group)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>live</span>
                        {evaluation && !evaluation.error ? (
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(tone))}>
                            {evaluation.decision} · {evaluation.confidence}%
                          </span>
                        ) : evaluation?.error ? (
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('amber'))}>awaiting data</span>
                        ) : loading ? (
                          <span className="text-[10px] text-slate-400">evaluating…</span>
                        ) : null}
                      </div>
                    </div>
                    <p className={cn('mt-3 text-sm', toneBody(strategy.tone))}>{strategy.description}</p>
                    <p className={cn('mt-2 text-[11px] font-mono', toneMuted(strategy.tone))}>{strategy.algorithm}</p>
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          <Card className={cn('border shadow-sm', toneCard('slate'))}>
            <CardHeader className={toneCardHeader('slate')}>
              <CardTitle className={cn('flex items-center gap-2', toneTitle('slate'))}>
                <Sparkles className="h-4 w-4" />
                Strategy Control
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {STRATEGY_CONTROL_MODULES.map((module) => {
                const summary = controlSummaryById.get(module.id);
                const signalTone = summary ? decisionTone(summary.decision) : 'slate';
                return (
                <Link
                  key={module.id}
                  href={`/institutional-strategy-intelligence/strategy-control/${module.id}`}
                  className={cn('rounded-xl border p-3 transition hover:shadow-md', toneCard(module.tone))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{module.label}</p>
                    {summary ? (
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(signalTone))}>
                        {summary.decision} · {summary.confidence}%
                      </span>
                    ) : modulesLoading ? (
                      <span className="text-[10px] text-slate-400">loading…</span>
                    ) : null}
                  </div>
                  <p className={cn('mt-1 text-xs', toneBody(module.tone))}>{summary?.summary ?? module.description}</p>
                </Link>
                );
              })}
            </CardContent>
          </Card>

          <Card className={cn('border shadow-sm', toneCard('violet'))}>
            <CardHeader className={toneCardHeader('violet')}>
              <CardTitle className={cn('flex items-center gap-2', toneTitle('violet'))}>
                <Sparkles className="h-4 w-4" />
                Research & Evolution
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {RESEARCH_EVOLUTION_MODULES.map((module) => {
                const summary = researchSummaryById.get(module.id);
                const signalTone = summary ? decisionTone(summary.decision) : 'slate';
                return (
                <Link
                  key={module.id}
                  href={`/institutional-strategy-intelligence/research-and-evolution/${module.id}`}
                  className={cn('rounded-xl border p-3 transition hover:shadow-md', toneCard(module.tone))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{module.label}</p>
                    {summary ? (
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(signalTone))}>
                        {summary.decision} · {summary.confidence}%
                      </span>
                    ) : modulesLoading ? (
                      <span className="text-[10px] text-slate-400">loading…</span>
                    ) : null}
                  </div>
                  <p className={cn('mt-1 text-xs', toneBody(module.tone))}>{summary?.summary ?? module.description}</p>
                </Link>
                );
              })}
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            {STRATEGY_GROUP_META.map((group) => {
              const strategies = listStrategiesByGroup(group.slug);
              const live = strategies.filter((item) => item.status === 'active');
              const planned = strategies.filter((item) => item.status === 'planned');
              return (
                <Card key={group.slug} className={cn('border shadow-sm', toneCard(group.tone))}>
                  <CardHeader className={toneCardHeader(group.tone)}>
                    <CardTitle className={cn('flex items-center justify-between gap-3', toneTitle(group.tone))}>
                      <span>{group.label}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(group.tone))}>
                        {live.length} live · {planned.length} queued
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className={cn('text-sm', toneBody(group.tone))}>{group.description}</p>
                    {live.length > 0 ? (
                      <div className="space-y-2">
                        <p className={cn('text-[11px] font-semibold uppercase tracking-wide', toneMuted(group.tone))}>Live engines</p>
                        {live.map((strategy) => {
                          const evaluation = evaluationById.get(strategy.id);
                          const signalTone = evaluation?.error ? 'amber' : decisionTone(evaluation?.decision ?? 'wait');
                          return (
                            <Link
                              key={strategy.id}
                              href={`/institutional-strategy-intelligence/${strategy.group}/${strategy.id}`}
                              className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition hover:opacity-90', toneInsetSurface(group.tone))}
                            >
                              <span className="font-medium text-slate-900">{strategy.label}</span>
                              {evaluation && !evaluation.error ? (
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(signalTone))}>
                                  {evaluation.decision} · {evaluation.confidence}%
                                </span>
                              ) : (
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>live</span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                    {planned.length > 0 ? (
                      <div className="space-y-2">
                        <p className={cn('text-[11px] font-semibold uppercase tracking-wide', toneMuted(group.tone))}>Roadmap</p>
                        {planned.slice(0, 4).map((strategy) => (
                          <Link
                            key={strategy.id}
                            href={`/institutional-strategy-intelligence/${strategy.group}/${strategy.id}`}
                            className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition hover:opacity-90', toneInsetSurface(group.tone))}
                          >
                            <span className="text-slate-700">{strategy.label}</span>
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('amber'))}>queued</span>
                          </Link>
                        ))}
                        {planned.length > 4 ? (
                          <p className={cn('text-xs', toneMuted(group.tone))}>+{planned.length - 4} more in catalog</p>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </section>

          {activeSymbols.length > 1 ? (
            <p className={cn('text-xs', toneMuted('slate'))}>
              Pipeline universe: {activeSymbols.slice(0, 12).join(', ')}
            </p>
          ) : null}
        </DashboardPageScroll>
      </DashboardPageShell>
    </DashboardPageFrame>
  );
}

function StatCard(props: { tone: DashboardTone; label: string; value: string; detail: string }) {
  return (
    <Card className={cn('border shadow-sm', toneCard(props.tone))}>
      <CardContent className="pt-6">
        <p className={cn('text-xs uppercase tracking-wide', toneMuted(props.tone))}>{props.label}</p>
        <p className={cn('mt-2 text-3xl font-semibold', toneMetric(props.tone))}>{props.value}</p>
        <p className={cn('mt-1 text-xs', toneBody(props.tone))}>{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function getGroupLabel(group: string): string {
  return STRATEGY_GROUP_META.find((item) => item.slug === group)?.label ?? group.replace(/-/g, ' ');
}
