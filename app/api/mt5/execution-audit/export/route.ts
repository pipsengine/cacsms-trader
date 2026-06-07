export const runtime = 'nodejs';

import { listExecutionAuditEvents } from '@/lib/execution-audit-journal-store';
import { assertExecutionAuditToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionAuditToolAccess(request);
    const url = new URL(request.url);

    const format = String(url.searchParams.get('format') ?? 'json').toLowerCase();
    const terminalId = url.searchParams.get('terminalId') ?? '';
    const accountNumber = url.searchParams.get('accountNumber') ?? '';
    const brokerName = url.searchParams.get('brokerName') ?? '';
    const environment = url.searchParams.get('environment') ?? '';
    const sourceSystem = url.searchParams.get('sourceSystem') ?? '';
    const severity = url.searchParams.get('severity') ?? '';
    const correlationId = url.searchParams.get('correlationId') ?? '';
    const query = url.searchParams.get('query') ?? '';
    const sinceTs = url.searchParams.get('sinceTs') ?? '';
    const untilTs = url.searchParams.get('untilTs') ?? '';

    const events = await listExecutionAuditEvents({
      terminalId: terminalId || undefined,
      accountNumber: accountNumber || undefined,
      brokerName: brokerName || undefined,
      environment: environment || undefined,
      sourceSystem: (sourceSystem || undefined) as any,
      severity: (severity || undefined) as any,
      correlationId: correlationId || undefined,
      query: query || undefined,
      sinceTs: sinceTs || undefined,
      untilTs: untilTs || undefined,
      limit: 5000,
      order: 'desc',
    });

    const filename = `execution-audit-${new Date().toISOString().replaceAll(':', '-')}.${format === 'csv' ? 'csv' : 'json'}`;

    if (format === 'csv') {
      const header = [
        'occurredAt',
        'sourceSystem',
        'severity',
        'eventType',
        'message',
        'correlationId',
        'terminalId',
        'accountNumber',
        'brokerName',
        'environment',
        'sandboxMode',
        'payload',
      ];
      const lines = [header.join(',')].concat(
        events.map((e) =>
          [
            e.occurredAt,
            e.sourceSystem,
            e.severity,
            e.eventType,
            e.message,
            e.correlationId ?? '',
            e.terminalId ?? '',
            e.accountNumber ?? '',
            e.brokerName ?? '',
            e.environment ?? '',
            e.sandboxMode == null ? '' : e.sandboxMode ? 'true' : 'false',
            JSON.stringify(e.payload ?? {}),
          ]
            .map(csvCell)
            .join(','),
        ),
      );

      return new Response(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return new Response(JSON.stringify({ ok: true, events }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to export audit logs.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const escaped = text.replaceAll('"', '""');
  return `"${escaped}"`;
}

