export const runtime = 'nodejs';

import { markTimeouts } from '@/lib/execution-bridge-store';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EXECUTION_BRIDGE_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Execution Bridge tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Execution Bridge tool requires local machine access.');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    const count = await markTimeouts();
    return Response.json({ ok: true, timedOut: count }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to reconcile queue.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

