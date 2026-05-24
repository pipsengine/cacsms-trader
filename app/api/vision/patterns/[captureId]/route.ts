export const runtime = 'nodejs';

import { getPatternAnalysis } from '@/lib/pattern-recognition-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const analysis = await getPatternAnalysis(captureId);
    return Response.json({ ok: true, analysis }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load pattern analysis.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
