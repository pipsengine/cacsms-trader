export const runtime = 'nodejs';

import { getCommandCenterTick } from '@/lib/command-center-tick';

export async function GET(request: Request): Promise<Response> {
  let tickCounter = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      write('retry: 2000\n');
      write('event: open\ndata: {}\n\n');

      let closed = false;
      request.signal.addEventListener('abort', () => {
        closed = true;
        controller.close();
      });

      while (!closed) {
        try {
          tickCounter += 1;
          const syncHeartbeats = tickCounter === 1 || tickCounter % 5 === 0;
          const includePositionDetails = tickCounter === 1 || tickCounter % 3 === 0;
          const tick = await getCommandCenterTick({ syncHeartbeats, includePositionDetails });
          write(`event: tick\n`);
          write(`data: ${JSON.stringify(tick)}\n\n`);
        } catch (error) {
          write(
            `event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : 'tick_stream_error',
            })}\n\n`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
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
