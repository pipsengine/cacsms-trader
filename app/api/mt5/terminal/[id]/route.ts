import { getTerminalHeartbeatHistory, getTerminalSnapshot } from '@/lib/mt5-heartbeat-store';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const terminal = await getTerminalSnapshot(id);

  if (!terminal) {
    return Response.json(
      { ok: false, error: 'Terminal not found', terminalId: id },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const history = await getTerminalHeartbeatHistory(id);

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
