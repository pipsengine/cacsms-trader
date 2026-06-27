import { verifyPassword } from '@/lib/platform-auth/password';
import { jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { disableMfa, getMfaStatus, prepareMfaEnrollment, verifyMfaEnrollment } from '@/lib/platform-auth/enterprise-store';
import { getUserByEmail, insertAuditLog } from '@/lib/platform-auth/store';
import { clientIp } from '@/lib/platform-auth/request-auth';

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const status = await getMfaStatus(auth.user.id);
    return jsonOk({ mfa: status });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load MFA status.', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request);
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? 'enroll');

    if (action === 'enroll') {
      const enrollment = await prepareMfaEnrollment(auth.user.id);
      await insertAuditLog({
        actorUserId: auth.user.id,
        category: 'security',
        action: 'mfa_enroll_started',
        detail: { method: enrollment.method },
        ipAddress: clientIp(request),
      });
      return jsonOk({ enrollment });
    }

    if (action === 'verify') {
      const mfa = await verifyMfaEnrollment(auth.user.id, String(body.code ?? ''));
      await insertAuditLog({
        actorUserId: auth.user.id,
        category: 'security',
        action: 'mfa_enabled',
        detail: { method: mfa.method },
        ipAddress: clientIp(request),
      });
      return jsonOk({ mfa });
    }

    if (action === 'disable') {
      const password = String(body.password ?? '');
      const record = await getUserByEmail(auth.user.email);
      if (!record || !verifyPassword(password, record.passwordHash)) {
        return jsonError('Current password is required to disable MFA.', 401);
      }
      await disableMfa(auth.user.id);
      await insertAuditLog({
        actorUserId: auth.user.id,
        category: 'security',
        action: 'mfa_disabled',
        detail: {},
        ipAddress: clientIp(request),
      });
      return jsonOk({ message: 'MFA disabled.' });
    }

    return jsonError('Invalid MFA action.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'MFA operation failed.', 500);
  }
}
