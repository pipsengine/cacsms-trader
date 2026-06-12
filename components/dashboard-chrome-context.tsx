'use client';

import { createContext, useContext } from 'react';

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
  return !pathname.startsWith('/api') && !pathname.startsWith('/commands') && !pathname.startsWith('/heartbeat');
}
