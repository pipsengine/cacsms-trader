import { PLATFORM_ADMIN_PAGES } from '@/lib/platform-admin-routes';

/** Paths reachable without an authenticated platform session when auth is enabled. */
export const PLATFORM_PUBLIC_PAGE_PREFIXES = [
  PLATFORM_ADMIN_PAGES.login,
  '/login',
  '/forgot-password',
  '/reset-password',
] as const;

export const PLATFORM_PUBLIC_API_PREFIXES = [
  '/api/platform-auth/login',
  '/api/platform-auth/request-password-reset',
  '/api/platform-auth/reset-password',
  '/api/mt5/heartbeat',
  '/api/mt5/register',
  '/api/mt5/commands',
  '/api/mt5/verify',
] as const;

export function isPlatformPublicPage(pathname: string): boolean {
  return PLATFORM_PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isPlatformPublicApi(pathname: string): boolean {
  return PLATFORM_PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function platformLoginUrl(redirectPath?: string): string {
  const base = PLATFORM_ADMIN_PAGES.login;
  if (!redirectPath || redirectPath === base) return base;
  return `${base}?redirect=${encodeURIComponent(redirectPath)}`;
}
