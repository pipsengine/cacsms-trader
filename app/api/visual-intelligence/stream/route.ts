export const runtime = 'nodejs';

import { listEvents } from '@/lib/visual-intelligence-store';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const queryCursor = url.searchParams.get('sinceId') ?? '0';
  const headerCursor = request.headers.get('last-event-id') ?? request.headers.get('Last-Event-ID') ?? '';
  let cursor = queryCursor !== '0' ? queryCursor : (headerCursor || queryCursor);

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
          const events = await listEvents(cursor, 200);
          for (const event of events) {
            cursor = event.id;
            write(`id: ${event.id}\n`);
            write(`event: ${event.eventType}\n`);
            write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch (error) {
          write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'visual_stream_error' })}\n\n`);
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
