export const runtime = 'nodejs';

import { getActiveOrderBlocks } from '@/lib/order-block-detection-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const active = await getActiveOrderBlocks(captureId);
    return Response.json({ ok: true, captureId, active }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load active order blocks.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
