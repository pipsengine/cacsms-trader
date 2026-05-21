export const runtime = 'nodejs';

import { listEaCommEvents } from '@/lib/ea-communication-store';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EA_COMM_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('EA Communication Engine tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('EA Communication Engine requires local machine access.');
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    const url = new URL(request.url);
    const sinceId = url.searchParams.get('sinceId') ?? '';
    const terminalId = url.searchParams.get('terminalId') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const limit = url.searchParams.get('limit') ?? '';

    const events = await listEaCommEvents({
      sinceId: sinceId || undefined,
      terminalId: terminalId || undefined,
      channel: (channel || undefined) as any,
      limit: limit ? Number(limit) : 250,
    });

    return Response.json({ ok: true, events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load logs.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

