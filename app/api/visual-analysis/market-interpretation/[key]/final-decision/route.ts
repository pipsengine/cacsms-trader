export const runtime = 'nodejs';

import { getFinalDecision } from '@/lib/visual-market-interpretation-store';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const interpretation = await getFinalDecision(key);
    if (!interpretation) {
      return Response.json({ ok: false, error: 'Final visual decision was not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, interpretation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load final visual decision.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
