import { canManageUser, hasPermission } from '@/lib/platform-auth/rbac';
import { isGlobalSuperAdminUser, GLOBAL_SUPER_ADMIN_PROTECTED_ERROR } from '@/lib/platform-auth/global-super-admin';
import { hashPassword } from '@/lib/platform-auth/password';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import {
  deletePlatformUser,
  deleteUserSessions,
  getMt5Config,
  getTradingConfig,
  getUserById,
  insertAuditLog,
  updatePlatformUser,
} from '@/lib/platform-auth/store';
import type { PlatformRole, PlatformUserStatus } from '@/lib/platform-auth/types';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const user = await getUserById(id);
    if (!user) return jsonError('User not found.', 404);
    if (!canManageUser(auth.user, user) && auth.user.id !== user.id) {
      return jsonError('Insufficient permissions.', 403);
    }

    const [mt5, trading] = await Promise.all([getMt5Config(id), getTradingConfig(id)]);
    return jsonOk({ user, mt5, trading });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load user.', 500);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const target = await getUserById(id);
    if (!target) return jsonError('User not found.', 404);

    const isSelf = auth.user.id === id;
    if (!isSelf && !canManageUser(auth.user, target)) {
      return jsonError('Insufficient permissions.', 403);
    }

    const body = await request.json().catch(() => ({}));
    const patch: Parameters<typeof updatePlatformUser>[1] = {};

    if (isGlobalSuperAdminUser(target) && !isSelf) {
      return jsonError(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR, 403);
    }

    if (isSelf && body.displayName !== undefined) {
      patch.displayName = String(body.displayName);
    }

    if (!isSelf && canManageUser(auth.user, target)) {
      if (isGlobalSuperAdminUser(target)) {
        return jsonError(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR, 403);
      }
      if (body.displayName !== undefined) patch.displayName = String(body.displayName);
      if (body.role !== undefined) {
        const role = String(body.role) as PlatformRole;
        if (auth.user.role !== 'super_admin' && role === 'super_admin') {
          return jsonError('Only super administrators can assign super admin role.', 403);
        }
        patch.role = role;
      }
      if (body.status !== undefined) patch.status = String(body.status) as PlatformUserStatus;
      if (body.managedByUserId !== undefined) patch.managedByUserId = body.managedByUserId;
      if (body.permissions !== undefined) {
        if (!hasPermission(auth.user, 'manage_roles_permissions')) {
          return jsonError('Insufficient permissions to modify role permissions.', 403);
        }
        patch.permissions = body.permissions;
      }
      if (body.password) patch.passwordHash = hashPassword(String(body.password));
    }

    if (Object.keys(patch).length === 0) {
      return jsonError('No valid fields to update.');
    }

    const user = await updatePlatformUser(id, patch);
    if (patch.status === 'disabled' || patch.status === 'suspended') {
      await deleteUserSessions(id);
    }

    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'admin',
      action: 'user_updated',
      detail: { fields: Object.keys(patch) },
      ipAddress: clientIp(request),
    });

    return jsonOk({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update user.';
    const status = message === GLOBAL_SUPER_ADMIN_PROTECTED_ERROR ? 403 : 500;
    return jsonError(message, status);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_users');
    if (auth instanceof Response) return auth;

    const { id } = await context.params;
    const target = await getUserById(id);
    if (!target) return jsonError('User not found.', 404);
    if (isGlobalSuperAdminUser(target)) {
      return jsonError(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR, 403);
    }
    if (!canManageUser(auth.user, target)) {
      return jsonError('Insufficient permissions.', 403);
    }

    await deletePlatformUser(id);
    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: id,
      category: 'admin',
      action: 'user_deleted',
      detail: { email: target.email, username: target.username },
      ipAddress: clientIp(request),
    });

    return jsonOk({ message: 'User deleted.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete user.';
    const status = message === GLOBAL_SUPER_ADMIN_PROTECTED_ERROR ? 403 : 500;
    return jsonError(message, status);
  }
}
