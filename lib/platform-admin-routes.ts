export const PLATFORM_ADMIN_PAGES = {
  overview: '/platform-administration',
  users: '/platform-administration/users',
  activeSessions: '/platform-administration/active-sessions',
  myProfile: '/platform-administration/my-profile',
  myMt5: '/platform-administration/my-mt5-connection',
  roles: '/platform-administration/roles-and-permissions',
  auditLog: '/platform-administration/audit-log',
  login: '/platform-administration/login',
} as const;

export function platformAdminUserDetail(userId: string): string {
  return `/platform-administration/users/${userId}`;
}

export function platformAdminPageIdFromPath(pathname: string): string | null {
  if (pathname === PLATFORM_ADMIN_PAGES.overview) return 'administration-dashboard';
  if (pathname === PLATFORM_ADMIN_PAGES.users) return 'user-management';
  if (pathname.startsWith(`${PLATFORM_ADMIN_PAGES.users}/`)) return 'user-management';
  if (pathname === PLATFORM_ADMIN_PAGES.activeSessions) return 'active-sessions';
  if (pathname === PLATFORM_ADMIN_PAGES.myProfile) return 'my-profile';
  if (pathname === PLATFORM_ADMIN_PAGES.myMt5) return 'my-mt5-connection';
  if (pathname === PLATFORM_ADMIN_PAGES.roles) return 'roles-and-permissions';
  if (pathname === PLATFORM_ADMIN_PAGES.auditLog) return 'audit-log';
  if (pathname === PLATFORM_ADMIN_PAGES.login) return 'platform-login';
  return null;
}

export function platformAdminHrefForPageId(pageId: string): string | null {
  const map: Record<string, string> = {
    'administration-dashboard': PLATFORM_ADMIN_PAGES.overview,
    'user-management': PLATFORM_ADMIN_PAGES.users,
    'active-sessions': PLATFORM_ADMIN_PAGES.activeSessions,
    'my-profile': PLATFORM_ADMIN_PAGES.myProfile,
    'my-mt5-connection': PLATFORM_ADMIN_PAGES.myMt5,
    'roles-and-permissions': PLATFORM_ADMIN_PAGES.roles,
    'audit-log': PLATFORM_ADMIN_PAGES.auditLog,
    'platform-login': PLATFORM_ADMIN_PAGES.login,
  };
  return map[pageId] ?? null;
}
