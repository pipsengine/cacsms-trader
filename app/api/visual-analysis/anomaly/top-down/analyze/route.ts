export const runtime = 'nodejs';

import { analyzeTopDownVisualAnomalies } from '@/lib/visual-anomaly-detection-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : 'XAUUSD';
    const reports = await analyzeTopDownVisualAnomalies(symbol);
    return Response.json({ ok: true, symbol, reports, scanned: reports.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run top-down anomaly scan.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
