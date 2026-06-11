import { maybeRunChartCaptureCleanup, runChartCaptureCleanup } from '@/lib/chart-capture-cleanup';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    const aggressive = url.searchParams.get('aggressive') === 'true';
    const result = force || aggressive
      ? await runChartCaptureCleanup(aggressive ? 'api-aggressive' : 'api-force', { aggressive })
      : await maybeRunChartCaptureCleanup('api');
    return Response.json(
      {
        ok: true,
        result: result ?? { status: 'skipped', detail: 'Cleanup interval not elapsed yet.' },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Chart capture cleanup failed.',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
