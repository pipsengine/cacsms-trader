import { PLATFORM_ROLES } from '@/lib/platform-auth/types';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { insertAuditLog } from '@/lib/platform-auth/store';
import { listAllRoleDefaults, updateRoleDefaultPermissions } from '@/lib/platform-auth/enterprise-store';
import type { PlatformRole } from '@/lib/platform-auth/types';

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_roles_permissions');
    if (auth instanceof Response) return auth;

    const defaults = await listAllRoleDefaults();
    return jsonOk({ roles: PLATFORM_ROLES, defaults });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load role defaults.', 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_roles_permissions');
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({}));
    const role = String(body.role ?? '') as PlatformRole;
    if (!PLATFORM_ROLES.includes(role)) return jsonError('Invalid role.');
    if (role === 'super_admin') return jsonError('Super administrator role defaults are immutable.');

    const permissions = await updateRoleDefaultPermissions(
      role,
      body.permissions ?? {},
      auth.user.id,
    );

    await insertAuditLog({
      actorUserId: auth.user.id,
      category: 'admin',
      action: 'role_defaults_updated',
      detail: { role, permissions },
      ipAddress: clientIp(request),
    });

    return jsonOk({ role, permissions });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update role defaults.', 500);
  }
}
