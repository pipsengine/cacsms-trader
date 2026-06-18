import { canManageUser } from '@/lib/platform-auth/rbac';
import { hashPassword } from '@/lib/platform-auth/password';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import {
  createPlatformUser,
  getUserByEmail,
  insertAuditLog,
  listPlatformUsers,
} from '@/lib/platform-auth/store';
import type { PlatformRole, PlatformUserStatus } from '@/lib/platform-auth/types';

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'view_all_users');
    if (auth instanceof Response) return auth;

    const users = await listPlatformUsers();
    const visible = auth.user.role === 'super_admin'
      ? users
      : users.filter((user) => canManageUser(auth.user, user) || user.id === auth.user.id);

    return jsonOk({ users: visible });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to list users.', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_users');
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const displayName = String(body.displayName ?? '').trim();
    const password = String(body.password ?? '');
    const role = String(body.role ?? 'trader') as PlatformRole;
    const status = String(body.status ?? 'active') as PlatformUserStatus;

    if (!email || !displayName || password.length < 8) {
      return jsonError('Email, display name, and password (min 8 chars) are required.');
    }

    if (auth.user.role !== 'super_admin' && role === 'super_admin') {
      return jsonError('Only super administrators can create super admin accounts.', 403);
    }

    const existing = await getUserByEmail(email);
    if (existing) return jsonError('A user with this email already exists.');

    const managedByUserId = auth.user.role === 'administrator' ? auth.user.id : body.managedByUserId ?? null;

    const user = await createPlatformUser({
      email,
      displayName,
      passwordHash: hashPassword(password),
      role,
      status,
      managedByUserId,
      permissions: body.permissions ?? {},
    });

    await insertAuditLog({
      actorUserId: auth.user.id,
      targetUserId: user.id,
      category: 'admin',
      action: 'user_created',
      detail: { email: user.email, role: user.role },
      ipAddress: clientIp(request),
    });

    return jsonOk({ user }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to create user.', 500);
  }
}
