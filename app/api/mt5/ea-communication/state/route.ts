export const runtime = 'nodejs';

import { listTerminalSnapshots } from '@/lib/mt5-heartbeat-store';
import { listEaCommEvents, summarizeEaComm } from '@/lib/ea-communication-store';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

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
    const terminalId = url.searchParams.get('terminalId') ?? '';
    const sinceId = url.searchParams.get('sinceId') ?? '';

    const [terminals, events, summary, bridgeHealth] = await Promise.all([
      listTerminalSnapshots(),
      listEaCommEvents({ terminalId: terminalId || undefined, sinceId: sinceId || undefined, limit: 250 }),
      summarizeEaComm({ windowMinutes: 120 }),
      fetch(`${bridgeUrl()}/health`, { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
    ]);

    return Response.json(
      {
        ok: true,
        bridge: {
          url: bridgeUrl(),
          online: bridgeHealth.ok,
          health: bridgeHealth.body,
        },
        terminals,
        events,
        summary,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load EA communication state.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

