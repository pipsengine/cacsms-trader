export const runtime = 'nodejs';

import { getLatestAiVisualInterpretation } from '@/lib/ai-visual-interpretation-store';

export async function GET(_request: Request, context: { params: Promise<{ key: string; timeframe: string }> }): Promise<Response> {
  try {
    const { key, timeframe } = await context.params;
    const interpretation = await getLatestAiVisualInterpretation(key, timeframe);
    if (!interpretation) {
      return Response.json({ ok: false, error: 'No latest AI visual interpretation exists for this symbol/timeframe.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, interpretation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load latest AI visual interpretation.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
