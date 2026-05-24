export const runtime = 'nodejs';

import { regenerateVisualMarketInterpretation } from '@/lib/visual-market-interpretation-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const interpretation = await regenerateVisualMarketInterpretation({
      symbol: typeof body.symbol === 'string' ? body.symbol : 'XAUUSD',
      timeframe: typeof body.timeframe === 'string' ? body.timeframe : undefined,
    });
    return Response.json({ ok: true, interpretation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to regenerate visual market interpretation.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
