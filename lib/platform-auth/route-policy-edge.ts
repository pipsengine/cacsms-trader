/** Edge-safe route policy — no Node/pg imports. Keep in sync with route-policy.ts */

export const PLATFORM_SESSION_COOKIE = 'cacsms_platform_session';

export const PLATFORM_PUBLIC_PAGE_PREFIXES = [
  '/platform-administration/login',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
] as const;

export const PLATFORM_PUBLIC_API_PREFIXES = [
  '/api/platform-auth/login',
  '/api/platform-auth/verify-mfa-login',
  '/api/platform-auth/request-password-reset',
  '/api/platform-auth/reset-password',
  '/api/platform-auth/me',
  '/api/platform-auth/accept-invite',
  '/api/system/runtime-bootstrap',
  '/api/mt5/heartbeat',
  '/api/mt5/register',
  '/api/mt5/commands',
  '/api/mt5/verify',
] as const;

export function isPlatformAuthEnabledEdge(): boolean {
  const value = String(process.env.PLATFORM_AUTH_ENABLED ?? 'true').toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}

export function isPlatformPublicPageEdge(pathname: string): boolean {
  return PLATFORM_PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isPlatformPublicApiEdge(pathname: string): boolean {
  return PLATFORM_PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
