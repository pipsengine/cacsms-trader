export const runtime = 'nodejs';

import { reprocessCapture } from '@/lib/chart-capture-intelligence';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const capture = await reprocessCapture(id);
    return Response.json({ ok: true, capture }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to reprocess capture.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
