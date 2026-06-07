export const runtime = 'nodejs';

import { getAiVisualInterpretation } from '@/lib/ai-visual-interpretation-store';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const interpretation = await getAiVisualInterpretation(key);
    if (!interpretation) {
      return Response.json({ ok: false, error: 'AI visual interpretation was not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, interpretation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load AI visual interpretation.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
