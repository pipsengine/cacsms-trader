import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { hashPassword, verifyPassword } from '@/lib/platform-auth/password';
import { clientIp, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { getPlatformSessionUserFromRequest } from '@/lib/platform-auth/session';
import { getUserByEmail, insertAuditLog, updatePlatformUser, deleteUserSessions } from '@/lib/platform-auth/store';
import { clearPlatformSession, createPlatformSession } from '@/lib/platform-auth/session';

export async function POST(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    const user = await getPlatformSessionUserFromRequest(request);
    if (!user) return jsonError('Authentication required.', 401);

    const body = await request.json().catch(() => ({}));
    const currentPassword = String(body.currentPassword ?? '');
    const newPassword = String(body.newPassword ?? '');

    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return jsonError('Current password and a new password (min 8 chars) are required.');
    }

    const record = await getUserByEmail(user.email);
    if (!record || !verifyPassword(currentPassword, record.passwordHash)) {
      return jsonError('Current password is incorrect.', 401);
    }

    await updatePlatformUser(user.id, { passwordHash: hashPassword(newPassword) });
    await deleteUserSessions(user.id);
    await clearPlatformSession();
    await createPlatformSession(user.id, {
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    await insertAuditLog({
      actorUserId: user.id,
      targetUserId: user.id,
      category: 'auth',
      action: 'password_changed',
      ipAddress: clientIp(request),
    });

    return jsonOk({ message: 'Password updated successfully.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to change password.', 500);
  }
}
