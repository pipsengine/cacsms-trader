export const runtime = 'nodejs';

import { getPatternProbability } from '@/lib/pattern-recognition-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const probability = await getPatternProbability(captureId);
    return Response.json({ ok: true, captureId, probability }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load pattern probability.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
