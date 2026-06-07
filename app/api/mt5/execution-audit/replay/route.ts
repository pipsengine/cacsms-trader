export const runtime = 'nodejs';

import { assertExecutionAuditToolAccess } from '@/lib/mt5-dev-tool-access';

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionAuditToolAccess(request);
    const body = (await request.json()) as any;
    const correlationId = String(body?.correlationId ?? '').trim();
    if (!correlationId) return Response.json({ ok: false, error: 'correlationId is required.' }, { status: 422 });

    const response = await fetch(`${new URL(request.url).origin}/api/mt5/execution-bridge/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: correlationId }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json({ ok: false, error: payload?.error ?? `Replay failed with HTTP ${response.status}` }, { status: 400 });
    }
    return Response.json({ ok: true, correlationId, replay: payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to replay event.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

