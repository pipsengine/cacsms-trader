export const runtime = 'nodejs';

import { getSupportResistanceAnalysis } from '@/lib/support-resistance-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const analysis = await getSupportResistanceAnalysis(captureId);
    return Response.json({ ok: true, analysis }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load support/resistance analysis.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
