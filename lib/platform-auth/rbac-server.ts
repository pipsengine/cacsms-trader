import type { PlatformPermissions, PlatformUserPublic } from '@/lib/platform-auth/types';
import { resolvePermissions } from '@/lib/platform-auth/rbac';

export async function resolvePermissionsAsync(
  user: Pick<PlatformUserPublic, 'role' | 'permissions'>,
): Promise<PlatformPermissions> {
  try {
    const { getRoleDefaultPermissions } = await import('@/lib/platform-auth/enterprise-store');
    const roleDefaults = await getRoleDefaultPermissions(user.role);
    return { ...roleDefaults, ...user.permissions };
  } catch {
    return resolvePermissions(user);
  }
}
