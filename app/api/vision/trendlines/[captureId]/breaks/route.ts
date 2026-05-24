export const runtime = 'nodejs';

import { getTrendlineBreaks } from '@/lib/trendline-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const breaks = await getTrendlineBreaks(captureId);
    return Response.json({ ok: true, captureId, breaks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load trendline breaks.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
