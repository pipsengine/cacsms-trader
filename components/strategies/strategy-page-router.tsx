'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { GenericStrategyDashboard } from '@/components/strategies/generic-strategy-dashboard';
import { DashboardPageFrame, DashboardPageScroll, DashboardPageShell } from '@/components/dashboard-page-frame';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMuted,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { getGroupMeta, getStrategyDefinitionByRoute } from '@/lib/strategies/registry';
import { cn } from '@/lib/utils';

export function StrategyPageRouter({ group, strategy }: { group: string; strategy: string }) {
  const definition = getStrategyDefinitionByRoute(group, strategy);
  if (definition?.status === 'active') {
    return <GenericStrategyDashboard definition={definition} />;
  }

  return <StrategyPlaceholderPage group={group} strategy={strategy} label={definition?.label} />;
}

function StrategyPlaceholderPage(props: { group: string; strategy: string; label?: string }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const definition = getStrategyDefinitionByRoute(props.group, props.strategy);
  const groupMeta = getGroupMeta(props.group);
  const label = definition?.label ?? props.label ?? props.strategy.replace(/-/g, ' ');
  const tone = definition?.tone ?? groupMeta?.tone ?? 'amber';

  return (
    <DashboardPageFrame
      bridgeOnline
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50"
    >
      <DashboardPageShell className="bg-slate-50">
        <header className="flex h-14 shrink-0 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
          <button type="button" className="rounded-md border border-slate-200 p-2 lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-4 w-4" />
          </button>
          <div className="ml-3">
            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', toneBody(tone))}>
              {groupMeta?.label ?? props.group.replace(/-/g, ' ')}
            </p>
            <h1 className="text-lg font-semibold text-slate-900">{label}</h1>
          </div>
        </header>
        <DashboardPageScroll className="space-y-4 p-4 lg:p-6">
          <Card className={cn('max-w-2xl border shadow-sm', toneCard(tone))}>
            <CardHeader className={toneCardHeader(tone)}>
              <CardTitle className={toneTitle(tone)}>Strategy module queued</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className={cn('text-sm', toneBody(tone))}>
                {definition?.description ?? `${groupMeta?.label ?? props.group.replace(/-/g, ' ')} — this model is registered in navigation and scheduled for engine deployment.`}
              </p>
              {definition?.algorithm ? (
                <p className={cn('rounded-lg border px-3 py-2 text-xs font-mono', toneInsetSurface(tone), toneMuted(tone))}>
                  {definition.algorithm}
                </p>
              ) : null}
              <p className={cn('text-xs', toneMuted(tone))}>
                Active engines run on reconstructed chart captures with institutional scoring, color-coded dashboards, and unified evaluation APIs.
              </p>
              <Link href="/institutional-strategy-intelligence" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Back to strategy overview
              </Link>
            </CardContent>
          </Card>
        </DashboardPageScroll>
      </DashboardPageShell>
    </DashboardPageFrame>
  );
}
