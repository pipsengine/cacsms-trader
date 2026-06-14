'use client';

import type { ElementType, ReactNode } from 'react';

import { useDashboardChrome } from '@/components/dashboard-chrome-context';
import { TraderSidebar } from '@/components/trader-sidebar';
import { cn } from '@/lib/utils';

/** Base flex shell — required on every dashboard page root inside the chrome. */
export const dashboardFrameClass =
  'relative z-0 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden';

/** Scroll region for page body content below a fixed/sticky header. */
export const dashboardScrollClass = 'min-h-0 flex-1 overflow-y-auto overscroll-y-contain';

export function DashboardPageShell(props: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', props.className)}>
      {props.children}
    </div>
  );
}

export function DashboardPageScroll(props: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  const Tag = props.as ?? 'main';
  return (
    <Tag className={cn(dashboardScrollClass, props.className)}>
      {props.children}
    </Tag>
  );
}

export function DashboardPageFrame(props: {
  children: ReactNode;
  bridgeOnline?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const chrome = useDashboardChrome();
  const frameClass = cn(dashboardFrameClass, props.className);

  if (chrome?.hasPersistedSidebar) {
    return (
      <div className={frameClass}>
        {props.children}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <TraderSidebar
        bridgeOnline={props.bridgeOnline ?? chrome?.bridgeOnline ?? false}
        mobileOpen={props.mobileOpen ?? chrome?.mobileSidebarOpen ?? false}
        onMobileOpenChange={props.onMobileOpenChange ?? chrome?.setMobileSidebarOpen ?? (() => undefined)}
      />
      <div className={frameClass}>
        {props.children}
      </div>
    </div>
  );
}
