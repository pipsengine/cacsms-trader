export const runtime = 'nodejs';

import { getVisionAnalysis } from '@/lib/cacsms-vision-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol') ?? undefined;
    return Response.json({ ok: true, analysis: await getVisionAnalysis(symbol) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load vision analysis.' }, { status: 500 });
  }
}
