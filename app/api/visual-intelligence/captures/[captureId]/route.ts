export const runtime = 'nodejs';

import { getCaptureAnalysis } from '@/lib/visual-intelligence-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const analysis = await getCaptureAnalysis(captureId);
    if (!analysis) {
      return Response.json({ ok: false, error: 'Capture not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, analysis }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load visual intelligence capture.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
