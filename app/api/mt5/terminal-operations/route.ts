import { approvePendingRegistrationsFromHeartbeats, listTerminalRegistrations } from '@/lib/mt5-registration-store';
import { listTerminalSnapshots, purgeTestTerminals, recordTerminalHeartbeat } from '@/lib/mt5-heartbeat-store';

export const runtime = 'nodejs';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(): Promise<Response> {
  await purgeTestTerminals();
  await approvePendingRegistrationsFromHeartbeats();
  let databaseRegistrations = await listTerminalRegistrations();
  let databaseTerminalIds = new Set(databaseRegistrations.map((registration) => registration.terminalId));

  try {
    const response = await fetch(`${bridgeUrl()}/terminal-operations`, { cache: 'no-store' });
    const payload = await response.json();
    const bridgeTerminals = (Array.isArray(payload?.terminals) ? payload.terminals : []).filter(
      (terminal: any) => !isTestTerminal(terminal?.terminalId),
    );

    if (response.ok && bridgeTerminals.length) {
      await Promise.allSettled(
        bridgeTerminals.map((terminal: any) => recordTerminalHeartbeat(mapBridgeTerminalToHeartbeatPayload(terminal))),
      );
      await approvePendingRegistrationsFromHeartbeats();
      databaseRegistrations = await listTerminalRegistrations();
      databaseTerminalIds = new Set(databaseRegistrations.map((registration) => registration.terminalId));
    }

    const databaseTerminals = await listTerminalSnapshots();
    const mergedTerminals = mergeTerminals(databaseTerminals, bridgeTerminals);

    return Response.json(
      {
        ...payload,
        bridgeOnline: response.ok,
        terminals: mergedTerminals,
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
    const databaseTerminals = await listTerminalSnapshots();
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

function isTestTerminal(terminalId: unknown): boolean {
  return String(terminalId ?? '').startsWith('TEST-');
}

function mapBridgeTerminalToHeartbeatPayload(terminal: any): Record<string, unknown> {
  return {
    terminalId: terminal.terminalId,
    computerId: terminal.computerId,
    computerName: terminal.computerName,
    accountNumber: terminal.accountNumber,
    brokerName: terminal.brokerName,
    serverName: terminal.serverName,
    balance: terminal.balance,
    equity: terminal.equity,
    margin: terminal.margin,
    freeMargin: terminal.freeMargin,
    openOrders: terminal.openOrders ?? terminal.openPositions,
    connectionStatus: terminal.connectionStatus ?? terminal.status,
    lastTickTime: terminal.lastTickTime,
    terminalTime: terminal.terminalTime,
    mt5ServerTime: terminal.mt5ServerTime,
    nigeriaTime: terminal.nigeriaTime,
    latencyMs: terminal.latencyMs,
    heartbeatIntervalSeconds: terminal.heartbeatIntervalSeconds,
    sequence: terminal.sequence,
    version: terminal.version ?? terminal.eaVersion,
    sentAt: terminal.sentAt,
  };
}

function mergeTerminals(databaseTerminals: any[], bridgeTerminals: any[]) {
  const merged = new Map<string, any>();
  databaseTerminals.forEach((terminal) => {
    if (terminal?.terminalId) {
      merged.set(String(terminal.terminalId), terminal);
    }
  });
  bridgeTerminals.forEach((terminal) => {
    const id = String(terminal?.terminalId ?? '');
    if (!id) return;
    if (!merged.has(id)) {
      merged.set(id, terminal);
      return;
    }
    merged.set(id, { ...terminal, ...merged.get(id) });
  });
  return Array.from(merged.values());
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
