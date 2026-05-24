export const runtime = 'nodejs';

import { getCandleClassifications } from '@/lib/candle-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const classifications = await getCandleClassifications(captureId);
    return Response.json({ ok: true, captureId, classifications }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load candle classifications.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
