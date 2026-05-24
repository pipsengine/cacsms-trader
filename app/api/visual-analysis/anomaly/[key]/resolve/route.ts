export const runtime = 'nodejs';

import { resolveVisualAnomaly } from '@/lib/visual-anomaly-detection-store';

export async function POST(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await context.params;
    const body = await request.json().catch(() => ({}));
    const anomaly = await resolveVisualAnomaly({
      id: key,
      note: typeof body.note === 'string' ? body.note : undefined,
      resolvedBy: typeof body.resolvedBy === 'string' ? body.resolvedBy : undefined,
    });
    return Response.json({ ok: true, anomaly }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to resolve visual anomaly.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
