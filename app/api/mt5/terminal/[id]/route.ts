import { getTerminalHeartbeatHistory, getTerminalSnapshot } from '@/lib/mt5-heartbeat-store';
import { getTerminalRegistration } from '@/lib/mt5-registration-store';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const terminal = await getTerminalSnapshot(id);

  if (!terminal) {
    const registration = await getTerminalRegistration(id);
    if (!registration) {
      return Response.json(
        { ok: false, error: 'Terminal not found', terminalId: id },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(
      {
        ok: true,
        hasHeartbeat: false,
        terminal: {
          terminalId: registration.terminalId,
          terminalName: registration.terminalName,
          computerId: registration.computerId,
          computerName: registration.computerName,
          accountNumber: registration.accountNumber,
          brokerName: registration.brokerName,
          serverName: registration.serverName,
          status: 'disconnected',
          receivedAt: registration.updatedAt,
          lastTickTime: registration.updatedAt,
          heartbeatAgeMs: 999_999,
          latencyMs: 0,
          version: registration.eaVersion,
        },
        history: [],
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const history = await getTerminalHeartbeatHistory(id);

  return Response.json(
    {
      ok: true,
      hasHeartbeat: true,
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
