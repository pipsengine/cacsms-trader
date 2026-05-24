export const runtime = 'nodejs';

import { getSwingLiquidity } from '@/lib/swing-point-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const liquidity = await getSwingLiquidity(captureId);
    return Response.json({ ok: true, captureId, liquidity }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load swing liquidity pivots.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
