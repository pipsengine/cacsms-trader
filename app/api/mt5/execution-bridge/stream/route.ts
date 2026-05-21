export const runtime = 'nodejs';

import { listExecutionEvents, markTimeouts } from '@/lib/execution-bridge-store';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EXECUTION_BRIDGE_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Execution Bridge tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Execution Bridge tool requires local machine access.');
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  let cursor = url.searchParams.get('sinceId') ?? '0';

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      write('retry: 1500\n');
      write('event: open\ndata: {}\n\n');

      let closed = false;
      request.signal.addEventListener('abort', () => {
        closed = true;
        controller.close();
      });

      while (!closed) {
        try {
          await markTimeouts();
          const events = await listExecutionEvents({ sinceId: cursor, limit: 200 });
          for (const event of events) {
            cursor = event.id;
            write(`id: ${event.id}\n`);
            write(`event: execution_event\n`);
            write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch (error) {
          write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'stream_error' })}\n\n`);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}

