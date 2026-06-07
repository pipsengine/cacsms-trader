export const runtime = 'nodejs';

import { listTerminalSnapshots } from '@/lib/mt5-heartbeat-store';
import { listExecutionAuditEvents, summarizeExecutionAudit } from '@/lib/execution-audit-journal-store';
import { assertExecutionAuditToolAccess } from '@/lib/mt5-dev-tool-access';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionAuditToolAccess(request);
    const url = new URL(request.url);

    const terminalId = url.searchParams.get('terminalId') ?? '';
    const accountNumber = url.searchParams.get('accountNumber') ?? '';
    const brokerName = url.searchParams.get('brokerName') ?? '';
    const environment = url.searchParams.get('environment') ?? '';
    const sourceSystem = url.searchParams.get('sourceSystem') ?? '';
    const severity = url.searchParams.get('severity') ?? '';
    const correlationId = url.searchParams.get('correlationId') ?? '';
    const query = url.searchParams.get('query') ?? '';
    const sinceTs = url.searchParams.get('sinceTs') ?? '';
    const limit = url.searchParams.get('limit') ?? '';

    const [terminals, events, summary, bridgeHealth] = await Promise.all([
      listTerminalSnapshots(),
      listExecutionAuditEvents({
        terminalId: terminalId || undefined,
        accountNumber: accountNumber || undefined,
        brokerName: brokerName || undefined,
        environment: environment || undefined,
        sourceSystem: (sourceSystem || undefined) as any,
        severity: (severity || undefined) as any,
        correlationId: correlationId || undefined,
        query: query || undefined,
        sinceTs: sinceTs || undefined,
        limit: limit ? Number(limit) : 250,
        order: 'desc',
      }),
      summarizeExecutionAudit({ windowMinutes: 240 }),
      fetch(`${bridgeUrl()}/health`, { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) })),
    ]);

    return Response.json(
      {
        ok: true,
        now: new Date().toISOString(),
        bridge: {
          url: bridgeUrl(),
          online: bridgeHealth.ok,
          health: bridgeHealth.body,
        },
        terminals,
        summary,
        events,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load audit state.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

