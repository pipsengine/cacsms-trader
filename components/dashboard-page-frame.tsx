'use client';

import type { ReactNode } from 'react';

import { useDashboardChrome } from '@/components/dashboard-chrome-context';
import { TraderSidebar } from '@/components/trader-sidebar';

export function DashboardPageFrame(props: {
  children: ReactNode;
  bridgeOnline?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const chrome = useDashboardChrome();

  if (chrome?.hasPersistedSidebar) {
    return (
      <div className={props.className ?? 'relative z-0 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'}>
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
      <div className={props.className ?? 'relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden'}>
        {props.children}
      </div>
    </div>
  );
}
