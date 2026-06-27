import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { isPlatformAuthEnabled } from '@/lib/platform-auth/constants';
import { verifyUserMfaCode } from '@/lib/platform-auth/enterprise-store';
import { hashToken } from '@/lib/platform-auth/password';
import { checkRateLimit, rateLimitResponse } from '@/lib/platform-auth/rate-limit';
import { clientIp, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { createPlatformSession } from '@/lib/platform-auth/session';
import { consumeMfaPendingLogin, getUserById, insertAuditLog } from '@/lib/platform-auth/store';

export async function POST(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    if (!isPlatformAuthEnabled()) return jsonError('Platform authentication is disabled.', 503);

    const ip = clientIp(request) ?? 'unknown';
    const rate = checkRateLimit({ scope: 'mfa-login', identifier: ip, limit: 20, windowMs: 15 * 60_000 });
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);

    const body = await request.json().catch(() => ({}));
    const mfaToken = String(body.mfaToken ?? '').trim();
    const code = String(body.code ?? '').trim();
    if (!mfaToken || !code) return jsonError('MFA token and code are required.');

    const userId = await consumeMfaPendingLogin(hashToken(mfaToken));
    if (!userId) return jsonError('Invalid or expired MFA session.', 401);

    const valid = await verifyUserMfaCode(userId, code);
    if (!valid) {
      await insertAuditLog({
        actorUserId: userId,
        category: 'auth',
        action: 'mfa_login_failed',
        ipAddress: clientIp(request),
      });
      return jsonError('Invalid MFA code.', 401);
    }

    const user = await getUserById(userId);
    if (!user || user.status !== 'active') return jsonError('Account is not active.', 403);

    await createPlatformSession(userId, {
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    await insertAuditLog({
      actorUserId: userId,
      category: 'auth',
      action: 'login_mfa',
      ipAddress: clientIp(request),
    });

    return jsonOk({ user, message: 'Signed in successfully.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to verify MFA.', 500);
  }
}
