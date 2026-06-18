export const PLATFORM_SESSION_COOKIE = 'cacsms_platform_session';
export const PLATFORM_SESSION_TTL_HOURS = Number(process.env.PLATFORM_AUTH_SESSION_TTL_HOURS ?? 24);

export function isPlatformAuthEnabled(): boolean {
  const value = String(process.env.PLATFORM_AUTH_ENABLED ?? 'true').toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}
