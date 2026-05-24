export const runtime = 'nodejs';

import { getVisualAnomalyByCapture } from '@/lib/visual-anomaly-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const report = await getVisualAnomalyByCapture(key);
    if (!report) {
      return Response.json({ ok: false, error: 'Visual anomaly report was not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load visual anomaly report.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
