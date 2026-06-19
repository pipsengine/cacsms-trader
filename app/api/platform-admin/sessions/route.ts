import { hashToken } from '@/lib/platform-auth/password';
import { readSessionTokenFromRequest } from '@/lib/platform-auth/session';
import { clientIp, jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { insertAuditLog } from '@/lib/platform-auth/store';
import { listActiveSessions, revokeSessionById } from '@/lib/platform-auth/enterprise-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_active_sessions');
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const token = readSessionTokenFromRequest(request);
    const currentHash = token ? hashToken(token) : null;

    const sessions = await listActiveSessions({
      userId: userId ?? undefined,
      limit: 200,
      currentTokenHash: currentHash,
    });

    return jsonOk({ sessions });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load sessions.', 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'manage_active_sessions');
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId) return jsonError('sessionId is required.');

    const revoked = await revokeSessionById(sessionId);
    if (!revoked) return jsonError('Session not found.', 404);

    await insertAuditLog({
      actorUserId: auth.user.id,
      category: 'security',
      action: 'session_revoked',
      detail: { sessionId },
      ipAddress: clientIp(request),
    });

    return jsonOk({ message: 'Session revoked.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to revoke session.', 500);
  }
}
