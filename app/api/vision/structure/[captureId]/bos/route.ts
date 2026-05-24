export const runtime = 'nodejs';

import { getStructureBos } from '@/lib/structure-analysis-store';

export async function GET(_request: Request, context: { params: Promise<{ captureId: string }> }): Promise<Response> {
  try {
    const { captureId } = await context.params;
    const bos = await getStructureBos(captureId);
    return Response.json({ ok: true, captureId, bos }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load BOS events.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
