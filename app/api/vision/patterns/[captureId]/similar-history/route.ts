export const runtime = 'nodejs';

import { getPatternSimilarHistory } from '@/lib/pattern-recognition-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const similarHistory = await getPatternSimilarHistory(captureId);
    return Response.json({ ok: true, captureId, similarHistory }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load similar pattern history.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
