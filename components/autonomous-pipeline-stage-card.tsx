'use client';

import type { LucideIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PIPELINE_STAGE_STATUS_META, type PipelineStageStatus } from '@/lib/autonomous-pipeline';
import { cn } from '@/lib/utils';

interface AutonomousPipelineStageCardProps {
  id: string;
  order: number;
  label: string;
  description: string;
  status: PipelineStageStatus;
  detail: string;
  progress: number;
  icon: LucideIcon;
  primaryHref: string;
  primaryLabel: string;
  relatedTools?: Array<{ label: string; href: string }>;
}

export function AutonomousPipelineStageCard({
  id,
  order,
  label,
  description,
  status,
  detail,
  progress,
  icon: Icon,
  primaryHref,
  primaryLabel,
  relatedTools = [],
}: AutonomousPipelineStageCardProps) {
  const meta = PIPELINE_STAGE_STATUS_META[status];

  return (
    <Card
      id={id}
      className={cn('scroll-mt-24 border shadow-sm shadow-slate-900/5 transition-colors', meta.border, meta.bg)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={cn('mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border bg-white', meta.border)}>
              <Icon className={cn('h-4 w-4', meta.text)} />
            </div>
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Stage {order}</p>
              <CardTitle className="text-base font-semibold text-slate-900">{label}</CardTitle>
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide',
              meta.border,
              meta.bg,
              meta.text,
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
            {meta.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">{description}</p>
        <p className="text-xs text-slate-500">{detail}</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Stage progress</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <Progress value={Math.min(100, Math.max(0, progress))} className="h-2" />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={primaryHref}
            className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-800 hover:border-violet-300"
          >
            {primaryLabel}
          </a>
          {relatedTools.map((tool) => (
            <a
              key={tool.href}
              href={tool.href}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-900"
            >
              {tool.label}
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
