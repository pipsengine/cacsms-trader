export const runtime = 'nodejs';

import { listEaCommEvents } from '@/lib/ea-communication-store';
import { assertEaCommunicationToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertEaCommunicationToolAccess(request);
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

