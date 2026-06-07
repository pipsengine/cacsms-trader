export const runtime = 'nodejs';

import { markTimeouts } from '@/lib/execution-bridge-store';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const count = await markTimeouts();
    return Response.json({ ok: true, timedOut: count }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to reconcile queue.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

