'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { DashboardChromeProvider, usesDashboardChrome } from '@/components/dashboard-chrome-context';
import { TraderSidebar } from '@/components/trader-sidebar';

export function PersistentDashboardChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const enabled = usesDashboardChrome(pathname);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadBridge = async () => {
      try {
        const response = await fetch('/api/mt5/status', { cache: 'no-store' });
        const payload = await response.json();
        if (!cancelled) setBridgeOnline(Boolean(payload?.ok));
      } catch {
        if (!cancelled) setBridgeOnline(false);
      }
    };
    void loadBridge();
    const interval = window.setInterval(() => void loadBridge(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const chromeValue = useMemo(
    () => ({
      hasPersistedSidebar: enabled,
      bridgeOnline,
      mobileSidebarOpen,
      setMobileSidebarOpen,
    }),
    [enabled, bridgeOnline, mobileSidebarOpen],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <DashboardChromeProvider value={chromeValue}>
      <div className="flex h-screen overflow-hidden bg-white">
        <TraderSidebar
          bridgeOnline={bridgeOnline}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </DashboardChromeProvider>
  );
}
