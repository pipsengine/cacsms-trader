export const runtime = 'nodejs';

import { listOpenPositions } from '@/lib/execution-open-positions';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const url = new URL(request.url);
    const terminalId = url.searchParams.get('terminalId') ?? undefined;
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const positions = await listOpenPositions({ terminalId, limit });
    return Response.json({ ok: true, positions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to list open positions.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
