export const runtime = 'nodejs';

import { getRiskStatus } from '@/lib/cacsms-vision-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol') ?? undefined;
    return Response.json({ ok: true, risk: await getRiskStatus(symbol) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load risk status.' }, { status: 500 });
  }
}
