import { getAutonomousPipelineStatus } from '@/lib/autonomous-pipeline-store';
import { resetAutonomousPipeline } from '@/lib/pipeline-reset';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = String((body as { symbol?: string }).symbol ?? 'AUTO').toUpperCase();
    const result = await resetAutonomousPipeline(symbol);
    const status = await getAutonomousPipelineStatus(symbol, { advance: false, runPairSelectionIfMissing: false });
    return Response.json({ ok: true, result, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to reset autonomous pipeline.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
