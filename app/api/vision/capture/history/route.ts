export const runtime = 'nodejs';

import { listCaptureHistory } from '@/lib/chart-capture-intelligence';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const captures = await listCaptureHistory(limit);
    return Response.json({ ok: true, captures }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load capture history.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
