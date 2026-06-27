import { bootstrapContinuousTradingRuntime } from '@/lib/continuous-trading-boot';
import { maybeRunChartCaptureCleanup, chartCaptureCleanupIntervalMs } from '@/lib/chart-capture-cleanup';

export const runtime = 'nodejs';

let started = false;

function isLocalRequest(request: Request): boolean {
  const host = request.headers.get('host') ?? '';
  return host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

export async function POST(request: Request): Promise<Response> {
  if (!isLocalRequest(request)) {
    return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  if (!started) {
    started = true;
    void bootstrapContinuousTradingRuntime();
    void maybeRunChartCaptureCleanup('startup');
    setInterval(() => {
      void maybeRunChartCaptureCleanup('scheduler');
    }, chartCaptureCleanupIntervalMs());
  }

  return Response.json({ ok: true, message: 'Runtime bootstrap complete.' }, { headers: { 'Cache-Control': 'no-store' } });
}
