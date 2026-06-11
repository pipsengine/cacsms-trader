'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrainCircuit, Menu, Sparkles } from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toneBadge, toneBody, toneCard, toneCardHeader, toneMuted, toneTitle } from '@/lib/dashboard-card-tones';
import { MOVING_AVERAGE_CROSSOVER_STRATEGY } from '@/lib/strategies/registry';
import { cn } from '@/lib/utils';

const ACTIVE_STRATEGIES = [MOVING_AVERAGE_CROSSOVER_STRATEGY];

export function StrategyOverviewDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
          <button type="button" className="rounded-md border border-slate-200 p-2 lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-4 w-4" />
          </button>
          <div className="ml-3 flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-600" />
            <h1 className="text-lg font-semibold text-slate-900">Strategy intelligence overview</h1>
          </div>
        </header>

        <main className="space-y-4 p-4 lg:p-6">
          <Card className={cn('border shadow-sm', toneCard('violet'))}>
            <CardHeader className={toneCardHeader('violet')}>
              <CardTitle className={cn('flex items-center gap-2', toneTitle('violet'))}>
                <Sparkles className="h-4 w-4" />
                Active strategy modules
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className={cn('text-sm', toneBody('violet'))}>
                Strategy pages are being built one by one. Each module gets its own evaluation engine, rules panel, and pipeline integration point.
              </p>
              {ACTIVE_STRATEGIES.map((strategy) => (
                <Link
                  key={strategy.id}
                  href={`/institutional-strategy-intelligence/${strategy.group}/${strategy.id}`}
                  className={cn('block rounded-lg border px-4 py-3 transition hover:border-violet-300', toneCard('slate'))}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{strategy.label}</p>
                      <p className={cn('mt-1 text-sm', toneMuted('slate'))}>{strategy.description}</p>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge('emerald'))}>
                      {strategy.status}
                    </span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
