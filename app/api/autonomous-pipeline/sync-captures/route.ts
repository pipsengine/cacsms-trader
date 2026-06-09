import { advancePipelineAnalysis } from '@/lib/autonomous-pipeline-analysis';
import { syncMt5CaptureAcks } from '@/lib/mt5-capture-ingest';
import { getAutonomousPipelineStatus } from '@/lib/autonomous-pipeline-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? 'XAUUSD').toUpperCase();
    const captureSummary = await syncMt5CaptureAcks({ symbol, limit: Number(body.limit ?? 12) });
    const analysisSummary = await advancePipelineAnalysis(symbol);
    const status = await getAutonomousPipelineStatus(symbol);
    return Response.json(
      { ok: true, captureSummary, analysisSummary, status },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to sync MT5 capture acknowledgments.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
