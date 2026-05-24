export const runtime = 'nodejs';

import { getChartSegmentation } from '@/lib/chart-segmentation-store';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const report = await getChartSegmentation(key);
    if (!report) {
      return Response.json({ ok: false, error: 'Chart segmentation report was not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load chart segmentation report.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
