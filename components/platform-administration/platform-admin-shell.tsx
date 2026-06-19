'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { useDashboardChrome } from '@/components/dashboard-chrome-context';
import {
  DashboardPageFrame,
  DashboardPageScroll,
  DashboardPageShell,
} from '@/components/dashboard-page-frame';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';
import { cn } from '@/lib/utils';

const NAV = [
  { href: PLATFORM_ADMIN_PAGES.overview, label: 'Admin dashboard' },
  { href: PLATFORM_ADMIN_PAGES.users, label: 'User management', permission: 'view_all_users' as const },
  { href: PLATFORM_ADMIN_PAGES.activeSessions, label: 'Active sessions', permission: 'manage_active_sessions' as const },
  { href: PLATFORM_ADMIN_PAGES.myProfile, label: 'My profile' },
  { href: PLATFORM_ADMIN_PAGES.myMt5, label: 'My MT5 connection', permission: 'manage_own_mt5' as const },
  { href: PLATFORM_ADMIN_PAGES.roles, label: 'Roles & permissions', permission: 'manage_roles_permissions' as const },
  { href: PLATFORM_ADMIN_PAGES.auditLog, label: 'Audit log', permission: 'view_audit_log' as const },
];

export function PlatformAdminShell(props: { title: string; subtitle: string; children: ReactNode }) {
  const chrome = useDashboardChrome();
  const pathname = usePathname();
  const auth = usePlatformAuth();

  return (
    <DashboardPageFrame>
      <DashboardPageShell>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-4 lg:px-6">
            {chrome?.hasPersistedSidebar ? (
              <Button type="button" variant="outline" size="icon" onClick={() => chrome.setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-700 text-white">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-950">{props.title}</h1>
                <p className="truncate text-sm text-slate-500">{props.subtitle}</p>
              </div>
            </div>
            {auth.user ? (
              <div className="hidden text-right text-sm sm:block">
                <div className="font-medium text-slate-900">{auth.user.displayName}</div>
                <div className="text-slate-500">{auth.user.email}</div>
              </div>
            ) : null}
            {auth.authenticated ? (
              <Button type="button" variant="outline" onClick={() => void auth.signOut()}>
                Sign out
              </Button>
            ) : (
              <Link href={PLATFORM_ADMIN_PAGES.login} className={buttonVariants({ variant: 'default' })}>
                Sign in
              </Link>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 lg:px-6">
            {NAV.filter((item) => !item.permission || auth.hasPermission(item.permission)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <DashboardPageScroll className="bg-white">
          <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">{props.children}</div>
        </DashboardPageScroll>
      </DashboardPageShell>
    </DashboardPageFrame>
  );
}

export function PlatformAuthGate(props: { children: ReactNode; loginRedirect?: string }) {
  const auth = usePlatformAuth();
  const pathname = usePathname();

  if (!auth.loaded) {
    return (
      <PlatformAdminShell title="Platform Administration" subtitle="Loading session…">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
          Verifying platform session…
        </div>
      </PlatformAdminShell>
    );
  }

  if (!auth.authenticated) {
    const redirect = encodeURIComponent(props.loginRedirect ?? pathname);
    return (
      <PlatformAdminShell title="Platform Administration" subtitle="Sign in required">
        <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-amber-950">Authentication required</h2>
          <p className="mt-2 text-sm text-amber-900">
            Sign in to access the multi-user trading administration center.
          </p>
          <Link
            href={`${PLATFORM_ADMIN_PAGES.login}?redirect=${redirect}`}
            className={cn(buttonVariants({ variant: 'default' }), 'mt-4 inline-flex')}
          >
            Go to sign in
          </Link>
        </div>
      </PlatformAdminShell>
    );
  }

  return <>{props.children}</>;
}
