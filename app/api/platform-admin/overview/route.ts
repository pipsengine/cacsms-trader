import { requirePlatformAuth, jsonError, jsonOk } from '@/lib/platform-auth/request-auth';
import { getAdminOverview } from '@/lib/platform-auth/store';

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'view_admin_dashboard');
    if (auth instanceof Response) return auth;

    const overview = await getAdminOverview();
    return jsonOk({ overview });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load admin overview.', 500);
  }
}
