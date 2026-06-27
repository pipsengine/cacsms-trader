import { generateToken, hashToken } from '@/lib/platform-auth/password';
import { sendUserInviteEmail } from '@/lib/platform-auth/email';
import { jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { createUserInvite, insertAuditLog } from '@/lib/platform-auth/store';
import { clientIp } from '@/lib/platform-auth/request-auth';
import type { PlatformRole } from '@/lib/platform-auth/types';
import { PLATFORM_ROLES } from '@/lib/platform-auth/types';

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_users');
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const displayName = String(body.displayName ?? '').trim();
    const role = String(body.role ?? 'trader') as PlatformRole;

    if (!email) return jsonError('Email is required.');
    if (!PLATFORM_ROLES.includes(role)) return jsonError('Invalid role.');
    if (auth.user.role !== 'super_admin' && role === 'super_admin') {
      return jsonError('Only Super Administrators can invite super admin accounts.');
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const inviteId = await createUserInvite({
      email,
      displayName,
      role,
      invitedByUserId: auth.user.id,
      tokenHash: hashToken(token),
      expiresAt,
    });

    const emailResult = await sendUserInviteEmail({
      email,
      token,
      invitedBy: auth.user.displayName,
    });

    await insertAuditLog({
      actorUserId: auth.user.id,
      category: 'admin',
      action: 'user_invited',
      detail: { email, role, inviteId },
      ipAddress: clientIp(request),
    });

    return jsonOk({
      inviteId,
      message: 'Invitation issued.',
      inviteUrl: emailResult.inviteUrl,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to create invite.', 500);
  }
}
