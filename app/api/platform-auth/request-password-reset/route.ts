import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { sendPasswordResetEmail } from '@/lib/platform-auth/email';
import { generateToken, hashToken } from '@/lib/platform-auth/password';
import { checkRateLimit, rateLimitResponse } from '@/lib/platform-auth/rate-limit';
import { clientIp, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { createPasswordReset, getUserByEmail, insertAuditLog } from '@/lib/platform-auth/store';

export async function POST(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    const ip = clientIp(request) ?? 'unknown';
    const rate = checkRateLimit({ scope: 'password-reset', identifier: ip, limit: 10, windowMs: 60 * 60_000 });
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) return jsonError('Email is required.');

    const user = await getUserByEmail(email);
    if (user && user.status === 'active') {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await createPasswordReset(user.id, hashToken(token), expiresAt);
      await insertAuditLog({
        actorUserId: user.id,
        targetUserId: user.id,
        category: 'auth',
        action: 'password_reset_requested',
        ipAddress: clientIp(request),
      });

      const emailResult = await sendPasswordResetEmail({ email: user.email, token });

      return jsonOk({
        message: 'If the account exists, a reset link has been issued.',
        resetToken: emailResult.resetUrl ? undefined : process.env.NODE_ENV === 'production' ? undefined : token,
        devResetUrl: emailResult.resetUrl,
      });
    }

    return jsonOk({ message: 'If the account exists, a reset link has been issued.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to request password reset.', 500);
  }
}
