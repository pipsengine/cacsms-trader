export const runtime = 'nodejs';

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

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
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

