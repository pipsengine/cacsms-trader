export const runtime = 'nodejs';

import { triggerVisionPaperTrade } from '@/lib/cacsms-vision-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json({ ok: true, paperTrade: await triggerVisionPaperTrade(typeof body.symbol === 'string' ? body.symbol : 'XAUUSD') });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to trigger paper trade.' }, { status: 400 });
  }
}
