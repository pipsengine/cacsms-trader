import { listTerminalRegistrations } from '@/lib/mt5-registration-store';
import { listTerminalSnapshots } from '@/lib/mt5-heartbeat-store';

export const runtime = 'nodejs';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(): Promise<Response> {
  const databaseRegistrations = await listTerminalRegistrations();
  const databaseTerminals = await listTerminalSnapshots();
  const databaseTerminalIds = new Set(databaseRegistrations.map((registration) => registration.terminalId));

  try {
    const response = await fetch(`${bridgeUrl()}/terminal-operations`, { cache: 'no-store' });
    const payload = await response.json();

    return Response.json(
      {
        ...payload,
        bridgeOnline: response.ok,
        terminals: databaseTerminals,
        registrations: databaseRegistrations,
        events: filterBridgeOnlyRegistrationEvents(payload.events ?? [], databaseTerminalIds),
      },
      {
        status: response.ok ? 200 : response.status,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: true,
        bridgeOnline: false,
        terminals: databaseTerminals,
        registrations: databaseRegistrations,
        routing: [],
        vps: [],
        commands: {
          summary: {
            total: 0,
            queued: 0,
            leased: 0,
            acknowledged: 0,
            expired: 0,
            dead: 0,
            recentAcks: [],
          },
          commands: [],
          recentAcks: [],
        },
        events: [
          {
            type: 'WARN',
            message: error instanceof Error ? `MT5 bridge unavailable: ${error.message}` : 'MT5 bridge unavailable.',
            time: new Date().toISOString(),
          },
        ],
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}

function filterBridgeOnlyRegistrationEvents(events: unknown[], databaseTerminalIds: Set<string>) {
  return events.filter((event) => {
    const item = event as { type?: unknown; message?: unknown };
    if (String(item.type ?? '') !== 'REGISTER') {
      return true;
    }

    const terminalId = String(item.message ?? '').match(/Registered terminal ([^\s]+)/)?.[1] ?? '';
    return !terminalId || databaseTerminalIds.has(terminalId);
  });
}
