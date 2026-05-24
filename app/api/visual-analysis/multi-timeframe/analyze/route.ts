export const runtime = 'nodejs';

import { analyzeSymbolMultiTimeframe } from '@/lib/multi-timeframe-analysis-store';
import type { MtfCandleInput, MtfTimeframe } from '@/lib/multi-timeframe-analysis-engine';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as {
      symbol?: string;
      candles?: MtfCandleInput;
      captureIds?: Partial<Record<MtfTimeframe, string>>;
    };
    if (!body.symbol) {
      return Response.json({ ok: false, error: 'symbol is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const result = await analyzeSymbolMultiTimeframe({
      symbol: body.symbol,
      candles: body.candles,
      captureIds: body.captureIds,
    });
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to analyze multi-timeframe structure.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
