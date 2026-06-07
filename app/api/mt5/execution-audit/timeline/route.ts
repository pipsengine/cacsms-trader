export const runtime = 'nodejs';

import { getExecutionAuditTimeline } from '@/lib/execution-audit-journal-store';
import { assertExecutionAuditToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionAuditToolAccess(request);
    const url = new URL(request.url);
    const correlationId = url.searchParams.get('correlationId') ?? '';
    const limit = url.searchParams.get('limit') ?? '';
    if (!correlationId) return Response.json({ ok: false, error: 'correlationId is required.' }, { status: 422 });
    const timeline = await getExecutionAuditTimeline({ correlationId, limit: limit ? Number(limit) : 600 });
    return Response.json({ ok: true, correlationId, timeline }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load timeline.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

