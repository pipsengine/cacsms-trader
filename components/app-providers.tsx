'use client';

import type { ReactNode } from 'react';

import { AppRouteGuard } from '@/components/app-route-guard';
import { ContinuousTradingSessionProvider } from '@/components/continuous-trading-session-provider';
import { PlatformAuthProvider } from '@/components/platform-auth-provider';
import { PersistentDashboardChrome } from '@/components/persistent-dashboard-chrome';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PlatformAuthProvider>
      <AppRouteGuard>
        <ContinuousTradingSessionProvider>
          <PersistentDashboardChrome>{children}</PersistentDashboardChrome>
        </ContinuousTradingSessionProvider>
      </AppRouteGuard>
    </PlatformAuthProvider>
  );
}
