export const runtime = 'nodejs';

import { getChannelBreakoutPressure } from '@/lib/channel-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const breakoutPressure = await getChannelBreakoutPressure(captureId);
    return Response.json({ ok: true, captureId, breakoutPressure }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load channel breakout pressure.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
