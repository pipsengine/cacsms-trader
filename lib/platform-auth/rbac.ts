import type { PlatformPermissionKey, PlatformPermissions, PlatformRole, PlatformUserPublic } from '@/lib/platform-auth/types';

const ROLE_DEFAULTS: Record<PlatformRole, PlatformPermissions> = {
  super_admin: {
    view_command_center: true,
    manage_own_profile: true,
    manage_own_mt5: true,
    manage_own_trading_config: true,
    view_own_trade_history: true,
    manage_users: true,
    manage_user_mt5: true,
    manage_user_trading: true,
    enable_disable_trading_engine: true,
    view_all_users: true,
    view_audit_log: true,
    manage_roles_permissions: true,
    view_admin_dashboard: true,
  },
  administrator: {
    view_command_center: true,
    manage_own_profile: true,
    manage_own_mt5: true,
    manage_own_trading_config: true,
    view_own_trade_history: true,
    manage_users: true,
    manage_user_mt5: true,
    manage_user_trading: true,
    enable_disable_trading_engine: true,
    view_all_users: true,
    view_audit_log: true,
    view_admin_dashboard: true,
  },
  trader: {
    view_command_center: true,
    manage_own_profile: true,
    manage_own_mt5: true,
    manage_own_trading_config: true,
    view_own_trade_history: true,
  },
  viewer: {
    view_command_center: true,
    manage_own_profile: true,
    view_audit_log: true,
    view_admin_dashboard: true,
  },
};

export function resolvePermissions(user: Pick<PlatformUserPublic, 'role' | 'permissions'>): PlatformPermissions {
  return { ...ROLE_DEFAULTS[user.role], ...user.permissions };
}

export function hasPermission(
  user: Pick<PlatformUserPublic, 'id' | 'role' | 'permissions'>,
  permission: PlatformPermissionKey,
): boolean {
  return Boolean(resolvePermissions(user)[permission]);
}

export function canManageUser(
  actor: PlatformUserPublic,
  target: Pick<PlatformUserPublic, 'id' | 'managedByUserId' | 'role'>,
): boolean {
  if (actor.role === 'super_admin') return true;
  if (!hasPermission(actor, 'manage_users')) return false;
  if (actor.role === 'administrator') {
    return target.managedByUserId === actor.id || target.id === actor.id;
  }
  return target.id === actor.id;
}

export function canViewUser(actor: PlatformUserPublic, targetId: string): boolean {
  if (actor.id === targetId) return true;
  if (hasPermission(actor, 'view_all_users')) {
    if (actor.role === 'super_admin') return true;
    if (actor.role === 'administrator') {
      return true;
    }
  }
  return false;
}

export function roleLabel(role: PlatformRole): string {
  const labels: Record<PlatformRole, string> = {
    super_admin: 'Super Administrator',
    administrator: 'Administrator',
    trader: 'Trader',
    viewer: 'Viewer / Auditor',
  };
  return labels[role];
}
