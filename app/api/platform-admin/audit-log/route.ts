import { jsonError, jsonOk, requirePlatformAuth } from '@/lib/platform-auth/request-auth';
import { listAuditLog } from '@/lib/platform-auth/store';

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requirePlatformAuth(request, 'view_audit_log');
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
    const category = url.searchParams.get('category') ?? undefined;
    const actorUserId = url.searchParams.get('actorUserId') ?? undefined;
    const since = url.searchParams.get('since') ?? undefined;
    const until = url.searchParams.get('until') ?? undefined;

    const entries = await listAuditLog({ limit, category, actorUserId, since, until });
    return jsonOk({ entries });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load audit log.', 500);
  }
}
