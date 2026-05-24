export const runtime = 'nodejs';

import { getSymbolMultiTimeframe } from '@/lib/multi-timeframe-analysis-store';

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }): Promise<Response> {
  try {
    const { symbol } = await context.params;
    const result = await getSymbolMultiTimeframe(symbol);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load multi-timeframe analysis.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
