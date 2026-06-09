'use client';

import { usePathname } from 'next/navigation';
import { Mt5OpsShell } from '@/components/mt5-ops-shell';

export default function Mt5InfrastructureLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const meta = resolveMt5Meta(pathname);

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
