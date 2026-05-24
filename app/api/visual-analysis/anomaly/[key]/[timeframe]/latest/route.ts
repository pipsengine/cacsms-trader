export const runtime = 'nodejs';

import { getLatestVisualAnomaly } from '@/lib/visual-anomaly-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ key: string; timeframe: string }> }): Promise<Response> {
  try {
    const { key, timeframe } = await context.params;
    const report = await getLatestVisualAnomaly(key, timeframe);
    if (!report) {
      return Response.json({ ok: false, error: 'No latest visual anomaly report exists for this symbol/timeframe.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load latest visual anomaly report.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
