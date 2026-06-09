export const runtime = 'nodejs';

import { getCacsmsVisionRoom } from '@/lib/cacsms-vision-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol') ?? 'XAUUSD';
    return Response.json(
      { ok: true, room: await getCacsmsVisionRoom(symbol), generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load Cacsms Vision status.' }, { status: 500 });
  }
}
