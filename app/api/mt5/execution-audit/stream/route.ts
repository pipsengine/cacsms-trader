export const runtime = 'nodejs';

import { listExecutionAuditEvents } from '@/lib/execution-audit-journal-store';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EXECUTION_AUDIT_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Execution Audit Journal tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Execution Audit Journal requires local machine access.');
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
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

