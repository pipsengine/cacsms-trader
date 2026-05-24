export const runtime = 'nodejs';

import { analyzeChartSegmentation } from '@/lib/chart-segmentation-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const report = await analyzeChartSegmentation({
      captureId: typeof body.captureId === 'string' ? body.captureId : undefined,
      symbol: typeof body.symbol === 'string' ? body.symbol : undefined,
      timeframe: typeof body.timeframe === 'string' ? body.timeframe : undefined,
    });
    return Response.json({ ok: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run AI chart segmentation.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
