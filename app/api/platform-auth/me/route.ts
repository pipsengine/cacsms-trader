import { bootstrapPlatformSuperAdmin } from '@/lib/platform-auth/bootstrap';
import { isPlatformAuthEnabled } from '@/lib/platform-auth/constants';
import { resolvePermissions } from '@/lib/platform-auth/rbac';
import { getPlatformSessionUser } from '@/lib/platform-auth/session';
import { jsonError, jsonOk } from '@/lib/platform-auth/request-auth';

export async function GET(): Promise<Response> {
  try {
    await bootstrapPlatformSuperAdmin();
    const user = await getPlatformSessionUser();
    return jsonOk({
      authenticated: Boolean(user),
      authEnabled: isPlatformAuthEnabled(),
      user,
      permissions: user ? resolvePermissions(user) : null,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load session.', 500);
  }
}
