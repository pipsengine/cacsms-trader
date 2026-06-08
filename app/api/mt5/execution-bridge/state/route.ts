export const runtime = 'nodejs';

import { listExecutionCommands, listExecutionEvents, markTimeouts, reconcileBridgeExecutionState } from '@/lib/execution-bridge-store';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    await reconcileBridgeExecutionState().catch(() => null);
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
