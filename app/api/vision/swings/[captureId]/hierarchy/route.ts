export const runtime = 'nodejs';

import { getSwingHierarchy } from '@/lib/swing-point-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const hierarchy = await getSwingHierarchy(captureId);
    return Response.json({ ok: true, captureId, hierarchy }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load swing hierarchy.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
