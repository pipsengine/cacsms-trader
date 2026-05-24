export const runtime = 'nodejs';

import { getCandleSequences } from '@/lib/candle-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const sequences = await getCandleSequences(captureId);
    return Response.json({ ok: true, captureId, sequences }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load candle sequence analysis.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
