export const runtime = 'nodejs';

import { runTradeMonitorTick } from '@/lib/trade-monitor-runtime';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const result = await runTradeMonitorTick(Date.now());
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Trade monitor tick failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
