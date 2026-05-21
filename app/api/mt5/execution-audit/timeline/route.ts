export const runtime = 'nodejs';

import { getExecutionAuditTimeline } from '@/lib/execution-audit-journal-store';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EXECUTION_AUDIT_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Execution Audit Journal tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Execution Audit Journal requires local machine access.');
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
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

