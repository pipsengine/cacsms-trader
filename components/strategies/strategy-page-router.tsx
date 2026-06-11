'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';

import { MovingAverageCrossoverDashboard } from '@/components/strategies/moving-average-crossover-dashboard';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneBody, toneCard, toneCardHeader, toneMuted, toneTitle } from '@/lib/dashboard-card-tones';
import { getStrategyDefinition } from '@/lib/strategies/registry';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function StrategyPageRouter({ group, strategy }: { group: string; strategy: string }) {
  if (strategy === 'moving-average-crossover' && group === 'trend-following-strategies') {
    return <MovingAverageCrossoverDashboard />;
  }

  return <StrategyPlaceholderPage group={group} strategy={strategy} />;
}

function StrategyPlaceholderPage({ group, strategy }: { group: string; strategy: string }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const definition = getStrategyDefinition(strategy);
  const label = definition?.label ?? strategy.replace(/-/g, ' ');

  return (
    <div className="flex min-h-screen bg-slate-50">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
          <button type="button" className="rounded-md border border-slate-200 p-2 lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-4 w-4" />
          </button>
          <h1 className="ml-3 text-lg font-semibold capitalize text-slate-900">{label}</h1>
        </header>
        <main className="p-4 lg:p-6">
          <Card className={cn('max-w-2xl border shadow-sm', toneCard('amber'))}>
            <CardHeader className={toneCardHeader('amber')}>
              <CardTitle className={toneTitle('amber')}>Strategy page queued for development</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className={cn('text-sm', toneBody('amber'))}>
                This strategy is registered in navigation but has not been implemented yet.
              </p>
              <p className={cn('text-xs', toneMuted('amber'))}>
                Group: {group.replace(/-/g, ' ')}
              </p>
              <Link href="/institutional-strategy-intelligence" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Back to strategy overview
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
