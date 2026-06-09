import { getAutonomousPipelineStatus } from '@/lib/autonomous-pipeline-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol') ?? 'AUTO';
    const advance = url.searchParams.get('advance') === 'true';
    const status = await getAutonomousPipelineStatus(symbol, { advance });
    return Response.json({ ok: true, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomous pipeline status.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
