import { getTerminalHeartbeatHistory, getTerminalSnapshot } from '@/lib/mt5-heartbeat-store';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ terminalId: string }> }): Promise<Response> {
  const { terminalId } = await context.params;
  const terminal = await getTerminalSnapshot(terminalId);

  if (!terminal) {
    return Response.json(
      { ok: false, error: 'Terminal not found', terminalId },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const history = await getTerminalHeartbeatHistory(terminalId);

  return Response.json(
    {
      ok: true,
      terminal,
      history,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
