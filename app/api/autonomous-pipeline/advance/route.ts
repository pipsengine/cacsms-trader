import { advanceAutonomousPipeline } from '@/lib/autonomous-pipeline-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? new URL(request.url).searchParams.get('symbol') ?? 'AUTO').toUpperCase();
    const result = await advanceAutonomousPipeline(symbol);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to advance autonomous pipeline.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
