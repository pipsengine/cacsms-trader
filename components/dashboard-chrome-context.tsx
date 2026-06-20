'use client';

import { createContext, useContext } from 'react';

import { isPlatformAuthOnlyPage } from '@/lib/platform-auth/route-policy';

export type DashboardChromeContextValue = {
  hasPersistedSidebar: boolean;
  bridgeOnline: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
};

const DashboardChromeContext = createContext<DashboardChromeContextValue | null>(null);

export function DashboardChromeProvider(props: {
  value: DashboardChromeContextValue;
  children: React.ReactNode;
}) {
  return (
    <DashboardChromeContext.Provider value={props.value}>
      {props.children}
    </DashboardChromeContext.Provider>
  );
}

export function useDashboardChrome(): DashboardChromeContextValue | null {
  return useContext(DashboardChromeContext);
}

export function usesDashboardChrome(pathname: string): boolean {
  if (pathname.startsWith('/api') || pathname.startsWith('/commands') || pathname.startsWith('/heartbeat')) {
    return false;
  }
  if (isPlatformAuthOnlyPage(pathname)) {
    return false;
  }
  return true;
}
