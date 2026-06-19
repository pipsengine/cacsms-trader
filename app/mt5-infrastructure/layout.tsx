'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Mt5OpsShell } from '@/components/mt5-ops-shell';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function Mt5InfrastructureLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = usePlatformAuth();
  const meta = resolveMt5Meta(pathname);

  if (auth.loaded && auth.authEnabled && !auth.hasPermission('view_mt5_infrastructure')) {
    return (
      <Mt5OpsShell title="MT5 Infrastructure" subtitle="Access restricted">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-amber-950">Insufficient permissions</h2>
          <p className="mt-2 text-sm text-amber-900">
            Your role does not include MT5 infrastructure visibility. Contact an administrator.
          </p>
          <Link href={PLATFORM_ADMIN_PAGES.overview} className={cn(buttonVariants({ variant: 'default' }), 'mt-4 inline-flex')}>
            Platform administration
          </Link>
        </div>
      </Mt5OpsShell>
    );
  }

  return (
    <Mt5OpsShell title={meta.title} subtitle={meta.subtitle}>
      {children}
    </Mt5OpsShell>
  );
}

function resolveMt5Meta(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/mt5-infrastructure') {
    return {
      title: 'MT5 Infrastructure & Broker Connectivity',
      subtitle: 'Bridge health, terminal fleet, readiness gates, and quick operations',
    };
  }

  const page = pathname.match(/^\/mt5-infrastructure\/terminal-operations\/([^/]+)$/)?.[1] ?? '';

  return {
    title: 'Terminal Operations',
    subtitle: terminalOperationsSubtitle(page),
  };
}

function terminalOperationsSubtitle(page: string): string {
  const mapping: Record<string, string> = {
    'connected-terminals': 'Connected terminals',
    'terminal-registration': 'Terminal registration',
    'terminal-heartbeat': 'Terminal heartbeat',
    'terminal-health-monitoring': 'Terminal health monitoring',
    'mt5-synchronization': 'MT5 synchronization',
    'mt5-execution-bridge': 'MT5 execution bridge',
    'live-latency-monitoring': 'Live latency monitoring',
    'multi-computer-support': 'Multi-computer support',
    'account-routing': 'Account routing',
    'vps-management': 'VPS management',
    'ea-deployment': 'EA deployment',
    'ea-deployment-link': 'EA Deployment Link Manager',
  };

  return mapping[page] ?? 'Terminal operations';
}
