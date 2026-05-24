export const runtime = 'nodejs';

import { analyzeAiVisualInterpretation } from '@/lib/ai-visual-interpretation-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const interpretation = await analyzeAiVisualInterpretation({
      captureId: typeof body.captureId === 'string' ? body.captureId : undefined,
      symbol: typeof body.symbol === 'string' ? body.symbol : undefined,
      timeframe: typeof body.timeframe === 'string' ? body.timeframe : undefined,
    });
    return Response.json({ ok: true, interpretation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to analyze AI visual interpretation.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
