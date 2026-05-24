export const runtime = 'nodejs';

import { getSymbolDecision } from '@/lib/multi-timeframe-analysis-store';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }): Promise<Response> {
  try {
    const { symbol } = await context.params;
    const decision = await getSymbolDecision(symbol);
    return Response.json({ ok: true, symbol: symbol.toUpperCase(), decision }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load multi-timeframe decision.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
