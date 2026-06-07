export const runtime = 'nodejs';

import { listExecutionAuditEvents } from '@/lib/execution-audit-journal-store';
import { assertExecutionAuditToolAccess } from '@/lib/mt5-dev-tool-access';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionAuditToolAccess(request);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const terminalId = url.searchParams.get('terminalId') ?? '';
  const accountNumber = url.searchParams.get('accountNumber') ?? '';
  const brokerName = url.searchParams.get('brokerName') ?? '';
  const environment = url.searchParams.get('environment') ?? '';
  const sourceSystem = url.searchParams.get('sourceSystem') ?? '';
  const severity = url.searchParams.get('severity') ?? '';
  const correlationId = url.searchParams.get('correlationId') ?? '';
  const query = url.searchParams.get('query') ?? '';

  let cursorTs = url.searchParams.get('sinceTs') ?? new Date(Date.now() - 30_000).toISOString();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (value: string) => controller.enqueue(encoder.encode(value));
      write(`retry: 2000\n\n`);

      while (true) {
        try {
          const batch = await listExecutionAuditEvents({
            sinceTs: cursorTs,
            terminalId: terminalId || undefined,
            accountNumber: accountNumber || undefined,
            brokerName: brokerName || undefined,
            environment: environment || undefined,
            sourceSystem: (sourceSystem || undefined) as any,
            severity: (severity || undefined) as any,
            correlationId: correlationId || undefined,
            query: query || undefined,
            order: 'asc',
            limit: 250,
          });

          for (const event of batch) {
            const occurredAt = String(event.occurredAt ?? '');
            if (occurredAt && Date.parse(occurredAt) > Date.parse(cursorTs)) {
              cursorTs = occurredAt;
            }
            write(`event: execution_audit_event\n`);
            write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch {
          write(`event: execution_audit_error\n`);
          write(`data: ${JSON.stringify({ message: 'stream_error' })}\n\n`);
        }

        await sleep(1000);
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
    },
  });
}

