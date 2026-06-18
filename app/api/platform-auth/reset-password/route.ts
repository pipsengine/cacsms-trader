import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { hashPassword, hashToken } from '@/lib/platform-auth/password';
import { clientIp, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { consumePasswordReset, deleteUserSessions, insertAuditLog, updatePlatformUser } from '@/lib/platform-auth/store';

export async function POST(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    const body = await request.json().catch(() => ({}));
    const token = String(body.token ?? '').trim();
    const newPassword = String(body.newPassword ?? '');

    if (!token || newPassword.length < 8) {
      return jsonError('Reset token and new password (min 8 chars) are required.');
    }

    const userId = await consumePasswordReset(hashToken(token));
    if (!userId) return jsonError('Invalid or expired reset token.', 400);

    await updatePlatformUser(userId, { passwordHash: hashPassword(newPassword) });
    await deleteUserSessions(userId);
    await insertAuditLog({
      actorUserId: userId,
      targetUserId: userId,
      category: 'auth',
      action: 'password_reset_completed',
      ipAddress: clientIp(request),
    });

    return jsonOk({ message: 'Password reset successfully. Please sign in again.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to reset password.', 500);
  }
}
