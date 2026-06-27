import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { hashPassword, hashToken } from '@/lib/platform-auth/password';
import { jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { consumeUserInvite, createPlatformUser, insertAuditLog } from '@/lib/platform-auth/store';
import { createPlatformSession } from '@/lib/platform-auth/session';
import { clientIp } from '@/lib/platform-auth/request-auth';
import type { PlatformRole } from '@/lib/platform-auth/types';

export async function POST(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    const body = await request.json().catch(() => ({}));
    const token = String(body.token ?? '').trim();
    const password = String(body.password ?? '');

    if (!token || password.length < 8) {
      return jsonError('Invite token and password (min 8 chars) are required.');
    }

    const invite = await consumeUserInvite(hashToken(token));
    if (!invite) return jsonError('Invalid or expired invitation.', 400);

    const user = await createPlatformUser({
      email: invite.email,
      displayName: invite.displayName,
      passwordHash: hashPassword(password),
      role: invite.role as PlatformRole,
      status: 'active',
    });

    await insertAuditLog({
      actorUserId: user.id,
      category: 'auth',
      action: 'invite_accepted',
      detail: { inviteId: invite.id, email: invite.email },
      ipAddress: clientIp(request),
    });

    await createPlatformSession(user.id, {
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    return jsonOk({ user, message: 'Account created. You are now signed in.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to accept invitation.', 500);
  }
}
