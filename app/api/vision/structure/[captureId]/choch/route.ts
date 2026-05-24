export const runtime = 'nodejs';

import { getStructureChoch } from '@/lib/structure-analysis-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const choch = await getStructureChoch(captureId);
    return Response.json({ ok: true, captureId, choch }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load CHOCH events.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
