import { clearPlatformSession } from '@/lib/platform-auth/session';
import { clientIp, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { getPlatformSessionUserFromRequest } from '@/lib/platform-auth/session';
import { insertAuditLog } from '@/lib/platform-auth/store';

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getPlatformSessionUserFromRequest(request);
    await clearPlatformSession();

    if (user) {
      await insertAuditLog({
        actorUserId: user.id,
        category: 'auth',
        action: 'logout',
        ipAddress: clientIp(request),
      });
    }

    return jsonOk({ message: 'Signed out successfully.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to sign out.', 500);
  }
}
