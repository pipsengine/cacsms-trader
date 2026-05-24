export const runtime = 'nodejs';

import { startCacsmsVisionScan } from '@/lib/cacsms-vision-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const symbols = Array.isArray(body.symbols) ? body.symbols.map(String) : typeof body.symbol === 'string' ? [body.symbol] : undefined;
    const timeframes = Array.isArray(body.timeframes) ? body.timeframes.map(String) : undefined;
    return Response.json({ ok: true, scan: await startCacsmsVisionScan({ symbols, timeframes, triggerSource: 'api_override' }) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to start Cacsms Vision scan.' }, { status: 400 });
  }
}
