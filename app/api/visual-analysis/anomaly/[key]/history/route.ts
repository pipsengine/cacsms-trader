export const runtime = 'nodejs';

import { getVisualAnomalyHistory } from '@/lib/visual-anomaly-detection-store';

export async function GET(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));
    const history = await getVisualAnomalyHistory(key, limit);
    return Response.json({ ok: true, history }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load visual anomaly history.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
