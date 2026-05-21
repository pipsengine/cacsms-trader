export const runtime = 'nodejs';

import { listExecutionCommands, listExecutionEvents, markTimeouts } from '@/lib/execution-bridge-store';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

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

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    await markTimeouts();

    const [commands, events, bridgeHealth, bridgeOps] = await Promise.all([
      listExecutionCommands({ limit: 200 }),
      listExecutionEvents({ limit: 200 }),
      fetch(`${bridgeUrl()}/health`, { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
      fetch(`${bridgeUrl()}/terminal-operations`, { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
    ]);

    return Response.json(
      {
        ok: true,
        bridge: {
          url: bridgeUrl(),
          health: bridgeHealth.body,
          terminalOperations: bridgeOps.body,
          online: bridgeHealth.ok && bridgeOps.ok,
        },
        commands,
        events,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load execution bridge state.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
