export const runtime = 'nodejs';

import { getLiquiditySweeps } from '@/lib/liquidity-zone-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const sweeps = await getLiquiditySweeps(captureId);
    return Response.json({ ok: true, captureId, sweeps }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load liquidity sweeps.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
