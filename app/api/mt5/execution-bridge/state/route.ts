export const runtime = 'nodejs';

import { listExecutionCommands, listExecutionEvents } from '@/lib/execution-bridge-store';
import { runExecutionMaintenance } from '@/lib/execution-retry-policy';
import { getExecutionPolicyStatus } from '@/lib/execution-policy';
import { getExecutionKillSwitchStatus } from '@/lib/execution-kill-switch';
import { listOpenPositions } from '@/lib/execution-open-positions';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const maintenance = await runExecutionMaintenance().catch(() => ({
      timeouts: 0,
      retried: 0,
      reconciled: 0,
      tradeMonitor: { evaluated: 0, actions: 0, dispatched: 0 },
    }));

    const [commands, events, bridgeHealth, bridgeOps, policy, killSwitch, openPositions] = await Promise.all([
      listExecutionCommands({ limit: 200 }),
      listExecutionEvents({ limit: 200 }),
      fetch(`${bridgeUrl()}/health`, { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
      fetch(`${bridgeUrl()}/terminal-operations`, { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
      getExecutionPolicyStatus(),
      getExecutionKillSwitchStatus(),
      listOpenPositions({ limit: 50 }),
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
        policy,
        killSwitch,
        maintenance,
        openPositions,
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
