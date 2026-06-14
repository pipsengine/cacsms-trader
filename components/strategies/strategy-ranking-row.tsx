'use client';

import Link from 'next/link';

import {
  toneBadge,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  type DashboardTone,
} from '@/lib/dashboard-card-tones';
import { strategyRankingHref } from '@/lib/strategies/book-ranking-utils';
import type { StrategyControlRankingRow } from '@/lib/strategies/strategy-control-types';
import { cn } from '@/lib/utils';

function decisionTone(decision: string): DashboardTone {
  if (decision === 'buy') return 'emerald';
  if (decision === 'sell') return 'rose';
  if (decision === 'neutral') return 'slate';
  return 'amber';
}

export function StrategyRankingRow(props: { row: StrategyControlRankingRow; tone: DashboardTone }) {
  const { row, tone } = props;
  const href = strategyRankingHref(row);
  const className = cn('flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition hover:shadow-sm', toneInsetSurface(tone));
  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{row.label}</p>
        <p className={cn('truncate text-[10px] uppercase tracking-wide', toneMuted(tone))}>
          {row.group.replace(/-/g, ' ')}
          {row.detail ? ` · ${row.detail}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(decisionTone(row.decision)))}>
          {row.decision}
        </span>
        <span className={cn('text-sm font-bold tabular-nums', toneMetric(tone))}>{row.score}</span>
      </div>
    </>
  );

  if (href) {
    return <Link key={`${row.id}-${row.label}`} href={href} className={className}>{content}</Link>;
  }

  return <div key={`${row.id}-${row.label}`} className={className}>{content}</div>;
}
