import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { touchSessionLastSeen } from '@/lib/platform-auth/enterprise-store';
import { hashToken } from '@/lib/platform-auth/password';
import { resolvePermissionsAsync } from '@/lib/platform-auth/rbac-server';
import { isPlatformAuthEnabled } from '@/lib/platform-auth/constants';
import { readSessionTokenFromRequest, getPlatformSessionUser } from '@/lib/platform-auth/session';
import { jsonError, jsonOk } from '@/lib/platform-auth/request-auth';

export async function GET(request: Request): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    const user = await getPlatformSessionUser();
    const token = readSessionTokenFromRequest(request);
    if (user && token) {
      await touchSessionLastSeen(hashToken(token));
    }
    return jsonOk({
      authenticated: Boolean(user),
      authEnabled: isPlatformAuthEnabled(),
      user,
      permissions: user ? await resolvePermissionsAsync(user) : null,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load session.', 500);
  }
}
