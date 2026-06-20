'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut, UserCircle, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { usePlatformAuth } from '@/components/platform-auth-provider';
import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';
import { roleLabel } from '@/lib/platform-auth/rbac';
import { cn } from '@/lib/utils';

export function PlatformUserHeaderMenu() {
  const auth = usePlatformAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!auth.loaded || !auth.authEnabled || !auth.authenticated || !auth.user) return null;

  const menuItems = [
    { href: PLATFORM_ADMIN_PAGES.myProfile, label: 'My profile', icon: UserCircle },
    ...(auth.hasPermission('manage_own_mt5')
      ? [{ href: PLATFORM_ADMIN_PAGES.myMt5, label: 'My MT5 connection', icon: Wallet }]
      : []),
  ];

  async function handleSignOut() {
    setOpen(false);
    await auth.signOut();
    router.push(PLATFORM_ADMIN_PAGES.login);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50',
          open && 'border-indigo-300 bg-indigo-50',
          pathname === PLATFORM_ADMIN_PAGES.myProfile && !open && 'border-indigo-200 bg-indigo-50/60',
        )}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <UserCircle className="h-5 w-5 shrink-0 text-indigo-700" />
        <div className="hidden min-w-0 sm:block">
          <div className="truncate font-medium text-slate-900">{auth.user.displayName}</div>
          <div className="truncate text-xs text-slate-500">{auth.user.email}</div>
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="font-medium text-slate-900">{auth.user.displayName}</div>
            <div className="text-xs text-slate-500">{auth.user.email}</div>
            <div className="mt-0.5 text-[11px] font-medium text-indigo-700">{roleLabel(auth.user.role)}</div>
          </div>
          {menuItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50',
                pathname === item.href && 'bg-indigo-50 font-medium text-indigo-800',
              )}
              onClick={() => setOpen(false)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
            onClick={() => void handleSignOut()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
