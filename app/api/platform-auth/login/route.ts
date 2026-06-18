import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { isPlatformAuthEnabled } from '@/lib/platform-auth/constants';
import { verifyPassword } from '@/lib/platform-auth/password';
import { clientIp, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { createPlatformSession } from '@/lib/platform-auth/session';
import { getUserByLoginIdentifier, insertAuditLog } from '@/lib/platform-auth/store';

export async function POST(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();

    if (!isPlatformAuthEnabled()) {
      return jsonError('Platform authentication is disabled.', 503);
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    if (!email || !password) {
      return jsonError('Email and password are required.');
    }

    const record = await getUserByLoginIdentifier(email);
    if (!record || record.status !== 'active' || !verifyPassword(password, record.passwordHash)) {
      await insertAuditLog({
        category: 'auth',
        action: 'login_failed',
        detail: { email },
        ipAddress: clientIp(request),
      });
      return jsonError('Invalid email or password.', 401);
    }

    await createPlatformSession(record.id, {
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    await insertAuditLog({
      actorUserId: record.id,
      category: 'auth',
      action: 'login',
      ipAddress: clientIp(request),
    });

    const { passwordHash: _, ...user } = record;
    return jsonOk({ user, message: 'Signed in successfully.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to sign in.', 500);
  }
}
