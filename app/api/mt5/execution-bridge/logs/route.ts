export const runtime = 'nodejs';

import { listExecutionEvents, markTimeouts } from '@/lib/execution-bridge-store';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    await markTimeouts();
    const url = new URL(request.url);
    const commandId = url.searchParams.get('commandId') ?? undefined;
    const sinceId = url.searchParams.get('sinceId') ?? undefined;
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
    const events = await listExecutionEvents({ commandId, sinceId, limit });
    return Response.json({ ok: true, events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load execution logs.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

