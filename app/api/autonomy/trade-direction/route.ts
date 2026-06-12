export const runtime = 'nodejs';

import { getAutonomyDirectionMetrics } from '@/lib/autonomy-direction-monitor';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const hours = Number(url.searchParams.get('hours') ?? 24);
    const metrics = await getAutonomyDirectionMetrics(hours);
    return Response.json({ ok: true, metrics }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy trade direction metrics.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
