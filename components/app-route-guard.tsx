'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { PlatformAuthLayout } from '@/components/platform-administration/platform-auth-layout';
import { usePlatformAuth } from '@/components/platform-auth-provider';
import { isPlatformPublicPage, platformLoginUrl } from '@/lib/platform-auth/route-policy';

export function AppRouteGuard({ children }: { children: ReactNode }) {
  const auth = usePlatformAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!auth.loaded || !auth.authEnabled) return;
    if (auth.authenticated) return;
    if (isPlatformPublicPage(pathname)) return;
    router.replace(platformLoginUrl(pathname));
  }, [auth.loaded, auth.authEnabled, auth.authenticated, pathname, router]);

  if (auth.authEnabled && auth.loaded && !auth.authenticated && !isPlatformPublicPage(pathname)) {
    return (
      <PlatformAuthLayout title="Authentication required" subtitle="Redirecting to sign in…">
        <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-900">Authentication required</p>
          <p className="mt-2 text-sm text-slate-600">Redirecting to sign in…</p>
        </div>
      </PlatformAuthLayout>
    );
  }

  return <>{children}</>;
}
