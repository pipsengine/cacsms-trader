export const runtime = 'nodejs';

import { getTrendlineRetests } from '@/lib/trendline-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const retests = await getTrendlineRetests(captureId);
    return Response.json({ ok: true, captureId, retests }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load trendline retests.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
