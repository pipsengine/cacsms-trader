'use client';

import type { ReactNode } from 'react';

import { ContinuousTradingSessionProvider } from '@/components/continuous-trading-session-provider';
import { PersistentDashboardChrome } from '@/components/persistent-dashboard-chrome';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ContinuousTradingSessionProvider>
      <PersistentDashboardChrome>{children}</PersistentDashboardChrome>
    </ContinuousTradingSessionProvider>
  );
}
