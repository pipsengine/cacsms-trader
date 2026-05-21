import { approvePendingRegistrationsFromHeartbeats, listTerminalRegistrations } from '@/lib/mt5-registration-store';
import { listTerminalSnapshots, purgeTestTerminals, recordTerminalHeartbeat } from '@/lib/mt5-heartbeat-store';
import { tickAutoExecutionTestRunner } from '@/lib/auto-execution-test-runner';

export const runtime = 'nodejs';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(): Promise<Response> {
  const preflightEvents: Array<{ type: string; message: string; time: string }> = [];
  try {
    await purgeTestTerminals();
  } catch (error) {
    preflightEvents.push({
      type: 'WARN',
      message: error instanceof Error ? `Database purge failed: ${error.message}` : 'Database purge failed.',
      time: new Date().toISOString(),
    });
  }
  try {
    await approvePendingRegistrationsFromHeartbeats();
  } catch (error) {
    preflightEvents.push({
      type: 'WARN',
      message: error instanceof Error ? `Registration approval failed: ${error.message}` : 'Registration approval failed.',
      time: new Date().toISOString(),
    });
  }

  let databaseRegistrations: any[] = [];
  let databaseTerminalIds = new Set<string>();
  try {
    databaseRegistrations = await listTerminalRegistrations();
    databaseTerminalIds = new Set(databaseRegistrations.map((registration) => registration.terminalId));
  } catch (error) {
    preflightEvents.push({
      type: 'WARN',
      message: error instanceof Error ? `Database registrations unavailable: ${error.message}` : 'Database registrations unavailable.',
      time: new Date().toISOString(),
    });
  }

  try {
    const response = await fetch(`${bridgeUrl()}/terminal-operations`, { cache: 'no-store' });
    const payload = await response.json();
    const bridgeTerminals = (Array.isArray(payload?.terminals) ? payload.terminals : []).filter(
      (terminal: any) => !isTestTerminal(terminal?.terminalId),
    );

    if (response.ok && bridgeTerminals.length) {
      await tickAutoExecutionTestRunner({ bridgeOnline: true, terminals: bridgeTerminals }).catch(() => null);
      await Promise.allSettled(
        bridgeTerminals.map((terminal: any) => recordTerminalHeartbeat(mapBridgeTerminalToHeartbeatPayload(terminal))),
      );
      try {
        await approvePendingRegistrationsFromHeartbeats();
      } catch (error) {
        preflightEvents.push({
          type: 'WARN',
          message: error instanceof Error ? `Registration approval failed: ${error.message}` : 'Registration approval failed.',
          time: new Date().toISOString(),
        });
      }
      try {
        databaseRegistrations = await listTerminalRegistrations();
        databaseTerminalIds = new Set(databaseRegistrations.map((registration) => registration.terminalId));
      } catch (error) {
        preflightEvents.push({
          type: 'WARN',
          message: error instanceof Error ? `Database registrations unavailable: ${error.message}` : 'Database registrations unavailable.',
          time: new Date().toISOString(),
        });
      }
    }

    let databaseTerminals: any[] = [];
    try {
      databaseTerminals = await listTerminalSnapshots();
    } catch (error) {
      preflightEvents.push({
        type: 'WARN',
        message: error instanceof Error ? `Database terminals unavailable: ${error.message}` : 'Database terminals unavailable.',
        time: new Date().toISOString(),
      });
    }
    const mergedTerminals = mergeTerminals(databaseTerminals, bridgeTerminals);

    return Response.json(
      {
        ...payload,
        bridgeOnline: response.ok,
        terminals: mergedTerminals,
        registrations: databaseRegistrations,
        events: [
          ...preflightEvents,
          ...filterBridgeOnlyRegistrationEvents(payload.events ?? [], databaseTerminalIds),
        ],
      },
      {
        status: response.ok ? 200 : response.status,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    let databaseTerminals: any[] = [];
    try {
      databaseTerminals = await listTerminalSnapshots();
    } catch (inner) {
      preflightEvents.push({
        type: 'WARN',
        message: inner instanceof Error ? `Database terminals unavailable: ${inner.message}` : 'Database terminals unavailable.',
        time: new Date().toISOString(),
      });
    }
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
          ...preflightEvents,
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
    accountType: terminal.accountType,
    enableExecution: terminal.enableExecution,
    accountTradeAllowed: terminal.accountTradeAllowed,
    terminalTradeAllowed: terminal.terminalTradeAllowed,
    eurusdAvailable: terminal.eurusdAvailable,
    xauusdAvailable: terminal.xauusdAvailable,
    eurusdSpreadPoints: terminal.eurusdSpreadPoints,
    xauusdSpreadPoints: terminal.xauusdSpreadPoints,
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
