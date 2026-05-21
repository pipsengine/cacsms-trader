export const runtime = 'nodejs';

import { listEaCommEvents } from '@/lib/ea-communication-store';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EA_COMM_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('EA Communication Engine tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('EA Communication Engine requires local machine access.');
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
  const queryCursor = url.searchParams.get('sinceId') ?? '';
  const headerCursor = request.headers.get('last-event-id') ?? request.headers.get('Last-Event-ID') ?? '';
  let cursor = queryCursor || headerCursor || '';

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (value: string) => controller.enqueue(encoder.encode(value));
      write(`retry: 2000\n\n`);

      while (true) {
        try {
          const batch = await listEaCommEvents({
            terminalId: terminalId || undefined,
            sinceId: cursor || undefined,
            limit: 200,
          });

          for (const event of batch) {
            cursor = event.id;
            write(`id: ${event.id}\n`);
            write(`event: ea_comm_event\n`);
            write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch {
          write(`event: ea_comm_error\n`);
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

