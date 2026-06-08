import { getAutonomousPipelineStatus } from '@/lib/autonomous-pipeline-store';
import { updateSchedules } from '@/lib/autonomy-store';
import { runAutonomousPairSelection } from '@/lib/pair-selector';
import { startTopDownSession } from '@/lib/top-down-orchestrator';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    let symbol = String(body.symbol ?? 'AUTO').toUpperCase();
    if (symbol === 'AUTO') {
      const selection = await runAutonomousPairSelection();
      symbol = selection.selectedSymbol;
      await updateSchedules({ config: { activeSymbols: selection.selectedSymbols } });
    }
    const terminalId = String(body.terminalId ?? '').trim();

    if (!terminalId) {
      const status = await getAutonomousPipelineStatus(symbol);
      const bridgeTerminals = Number(status.connectedTerminals);
      if (bridgeTerminals === 0) {
        return Response.json(
          { ok: false, error: 'No connected terminal available. Attach the EA to a demo chart first.' },
          { status: 400 },
        );
      }
      return Response.json(
        { ok: false, error: 'terminalId is required to start a top-down session.' },
        { status: 400 },
      );
    }

    const session = await startTopDownSession({ symbol, terminalId, mode: 'full_auto' });
    const status = await getAutonomousPipelineStatus(symbol);
    return Response.json({ ok: true, session, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to start autonomous pipeline session.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
