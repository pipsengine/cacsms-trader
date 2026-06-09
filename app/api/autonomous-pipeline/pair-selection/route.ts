import { updateSchedules } from '@/lib/autonomy-store';
import { getAutonomousPipelineStatus } from '@/lib/autonomous-pipeline-store';
import { runAutonomousPairSelection } from '@/lib/pair-selector';

export async function GET(): Promise<Response> {
  try {
    const status = await getAutonomousPipelineStatus('AUTO', { advance: false });
    return Response.json({ ok: true, selection: status.pairSelection, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load pair selection.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(): Promise<Response> {
  try {
    const selection = await runAutonomousPairSelection();
    await updateSchedules({ config: { activeSymbols: selection.selectedSymbols } });
    const status = await getAutonomousPipelineStatus(selection.selectedSymbol);
    return Response.json({ ok: true, selection, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run pair selection.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
