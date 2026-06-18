/** Immutable Global Super Administrator — cannot be deleted (enforced in DB + application). */
export const GLOBAL_SUPER_ADMIN_ID = '00000000-0000-4000-8000-000000000001';

export const GLOBAL_SUPER_ADMIN_USERNAME = 'Admin';

export const GLOBAL_SUPER_ADMIN_DISPLAY_NAME = 'Super Administrator';

export const GLOBAL_SUPER_ADMIN_EMAIL = 'admin@cacsms.com';

export function globalSuperAdminEmail(): string {
  return String(process.env.GLOBAL_SUPER_ADMIN_EMAIL ?? GLOBAL_SUPER_ADMIN_EMAIL).trim().toLowerCase();
}

export function globalSuperAdminPassword(): string {
  return String(process.env.GLOBAL_SUPER_ADMIN_PASSWORD ?? 'P@882w0rd');
}

export function isGlobalSuperAdminUser(user: {
  id: string;
  email?: string;
  username?: string | null;
  isSystemProtected?: boolean;
}): boolean {
  return (
    user.isSystemProtected === true
    || user.id === GLOBAL_SUPER_ADMIN_ID
    || user.email?.toLowerCase() === globalSuperAdminEmail()
    || user.username === GLOBAL_SUPER_ADMIN_USERNAME
  );
}

export const GLOBAL_SUPER_ADMIN_PROTECTED_ERROR =
  'The Global Super Administrator account is system-protected and cannot be deleted or disabled.';
