import { randomUUID } from 'node:crypto';
import { appendEaCommEvent } from '@/lib/ea-communication-store';
import { queryPostgres } from '@/lib/postgres';
import { appendExecutionEvent, reconcileBridgeExecutionState } from '@/lib/execution-bridge-store';
import { dispatchExecutionCommand } from '@/lib/execution-dispatch';
import { isExecutionEnabled } from '@/lib/execution-policy';
import { rankedTradableSymbols } from '@/lib/mt5-symbol-telemetry';

export const runtime = 'nodejs';

export type AutoTestRunnerState =
  | 'IDLE'
  | 'WAITING_FOR_TERMINAL'
  | 'VALIDATING'
  | 'READY'
  | 'DISPATCHING'
  | 'ACKNOWLEDGED'
  | 'EXECUTED'
  | 'FAILED'
  | 'DISABLED_AFTER_SUCCESS';

type BridgeTerminal = {
  terminalId: string;
  status: 'connected' | 'degraded' | 'disconnected';
  heartbeatAgeMs: number;
  openOrders?: number;
  accountType?: string;
  enableExecution?: boolean;
  accountTradeAllowed?: boolean;
  terminalTradeAllowed?: boolean;
  eurusdAvailable?: boolean;
  xauusdAvailable?: boolean;
  eurusdSpreadPoints?: number;
  xauusdSpreadPoints?: number;
  symbolTelemetry?: unknown;
};

type AutoTestToggleEventType = 'AUTO_TEST_ENABLED' | 'AUTO_TEST_DISABLED' | 'AUTO_TEST_DISABLED_AFTER_SUCCESS';

type AutoTestLogEvent = {
  id: string;
  terminalId: string | null;
  eventType: string;
  severity: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AutoTestStatusPayload = {
  enabled: boolean;
  state: AutoTestRunnerState;
  runId: string | null;
  terminalId: string | null;
  countdownSeconds: number | null;
  safetyChecks: Array<{ name: string; ok: boolean; detail: string }>;
  lastResult: { state: AutoTestRunnerState; commandId: string | null; ticket: string | null; message: string | null; updatedAt: string | null };
  logs: AutoTestLogEvent[];
};

function envValue(name: string): string {
  const direct = process.env[name];
  if (direct != null) return String(direct);
  if (name.startsWith('NEXT_PUBLIC_')) return '';
  const nextPublic = process.env[`NEXT_PUBLIC_${name}`];
  return nextPublic == null ? '' : String(nextPublic);
}

function envBool(name: string, fallback = false): boolean {
  const raw = envValue(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function envNumber(name: string, fallback: number): number {
  const raw = envValue(name).trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

function normalizeAccountType(value: unknown): 'demo' | 'live' | 'prop_firm' | 'unknown' {
  const raw = String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
  if (raw === 'demo' || raw === 'contest') return 'demo';
  if (raw === 'live' || raw === 'real') return 'live';
  if (raw === 'prop' || raw === 'prop_firm' || raw === 'propfirm') return 'prop_firm';
  return 'unknown';
}

function pickBestBridgeTerminal(terminals: BridgeTerminal[], heartbeatFreshMs: number): BridgeTerminal | null {
  if (!terminals.length) return null;
  const connectedFresh = terminals.find(
    (terminal) => terminal.status === 'connected' && Number(terminal.heartbeatAgeMs ?? 0) <= heartbeatFreshMs,
  );
  if (connectedFresh) return connectedFresh;
  const connected = terminals.find((terminal) => terminal.status === 'connected');
  if (connected) return connected;
  return [...terminals].sort((a, b) => Number(a.heartbeatAgeMs ?? Number.MAX_SAFE_INTEGER) - Number(b.heartbeatAgeMs ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
}

function describeTerminalPresence(terminal: BridgeTerminal | null, heartbeatFreshMs: number): string {
  if (!terminal) return 'No terminal has heartbeated the bridge yet.';
  const heartbeatAgeMs = Math.round(Number(terminal.heartbeatAgeMs ?? 0));
  if (terminal.status === 'connected' && heartbeatAgeMs <= heartbeatFreshMs) {
    return `Terminal ${terminal.terminalId} is connected (heartbeat age ${heartbeatAgeMs}ms).`;
  }
  if (terminal.status === 'connected') {
    return `Terminal ${terminal.terminalId} is connected but heartbeat age ${heartbeatAgeMs}ms exceeds ${heartbeatFreshMs}ms.`;
  }
  return `Terminal ${terminal.terminalId} is ${terminal.status} (last heartbeat ${heartbeatAgeMs}ms ago). Keep the EA attached and recompile the latest EA if sequence stays at 1.`;
}

function pickSymbol(terminal: BridgeTerminal, maxSpreadPoints: number): { symbol: 'EURUSD' | 'XAUUSD' | null; reason: string } {
  const ranked = rankedTradableSymbols(terminal, undefined, maxSpreadPoints);
  if (ranked.length > 0) {
    const best = ranked[0];
    if (best.symbol === 'EURUSD' || best.symbol === 'XAUUSD') {
      return { symbol: best.symbol, reason: `${best.symbol} selected from EA telemetry (${best.spreadPoints} pts spread).` };
    }
  }

  const telemetryMissing =
    terminal.eurusdAvailable == null
    && terminal.xauusdAvailable == null
    && terminal.eurusdSpreadPoints == null
    && terminal.xauusdSpreadPoints == null
    && !Array.isArray(terminal.symbolTelemetry);
  if (telemetryMissing) return { symbol: 'EURUSD', reason: 'Symbol telemetry missing; attempting EURUSD as default.' };

  const eurusdOk = Boolean(terminal.eurusdAvailable) && Number.isFinite(Number(terminal.eurusdSpreadPoints)) && Number(terminal.eurusdSpreadPoints) <= maxSpreadPoints;
  if (eurusdOk) return { symbol: 'EURUSD', reason: 'EURUSD available and within spread limit.' };
  const xauusdOk = Boolean(terminal.xauusdAvailable) && Number.isFinite(Number(terminal.xauusdSpreadPoints)) && Number(terminal.xauusdSpreadPoints) <= maxSpreadPoints;
  if (xauusdOk) return { symbol: 'XAUUSD', reason: 'EURUSD unavailable/too wide; XAUUSD verified and within spread limit.' };
  return { symbol: null, reason: 'No verified symbol within spread limit.' };
}

async function hasEaCommEventsTable(): Promise<boolean> {
  try {
    const result = await queryPostgres(
      `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'ea_comm_events'
        LIMIT 1
      `,
    );
    return Boolean(result.rows[0]);
  } catch {
    return false;
  }
}

async function getLastToggle(): Promise<{
  type: AutoTestToggleEventType | null;
  runId: string | null;
  createdAt: string | null;
}> {
  try {
    const result = await queryPostgres(
      `
        SELECT event_type, payload, created_at
        FROM ea_comm_events
        WHERE event_type = ANY($1)
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [['AUTO_TEST_ENABLED', 'AUTO_TEST_DISABLED', 'AUTO_TEST_DISABLED_AFTER_SUCCESS']],
    );

    const row = result.rows[0] as any;
    if (!row) return { type: null, runId: null, createdAt: null };
    const payload = (row.payload ?? {}) as any;
    return {
      type: String(row.event_type) as AutoTestToggleEventType,
      runId: payload?.runId ? String(payload.runId) : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  } catch {
    return { type: null, runId: null, createdAt: null };
  }
}

async function getLastEnabledRun(): Promise<{ runId: string | null; createdAt: string | null }> {
  try {
    const result = await queryPostgres(
      `
        SELECT payload, created_at
        FROM ea_comm_events
        WHERE event_type = 'AUTO_TEST_ENABLED'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    );
    const row = result.rows[0] as any;
    if (!row) return { runId: null, createdAt: null };
    const payload = (row.payload ?? {}) as any;
    return {
      runId: payload?.runId ? String(payload.runId) : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  } catch {
    return { runId: null, createdAt: null };
  }
}

async function hasExecutedAutoTest(runId: string | null): Promise<boolean> {
  if (!runId) return false;
  const result = await queryPostgres(
    `
      SELECT command_id
      FROM execution_commands
      WHERE payload->>'source' = 'AUTO_TEST_RUNNER'
        AND payload->>'runId' = $1
        AND lifecycle_state = 'EXECUTED'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [runId],
  );
  return Boolean(result.rows[0]);
}

async function getLatestAutoTestCommand(runId: string | null): Promise<any | null> {
  const whereRun = runId ? `AND payload->>'runId' = $1` : '';
  const params = runId ? [runId] : [];
  const result = await queryPostgres(
    `
      SELECT *
      FROM execution_commands
      WHERE payload->>'source' = 'AUTO_TEST_RUNNER'
      ${whereRun}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params as any,
  );
  return (result.rows[0] as any) ?? null;
}

async function listAutoTestLogs(runId: string | null, limit = 120): Promise<AutoTestLogEvent[]> {
  if (!(await hasEaCommEventsTable())) return [];
  const params: any[] = [];
  const conditions: string[] = [`event_type LIKE 'AUTO_TEST_%'`];
  if (runId) {
    params.push(runId);
    conditions.push(`payload->>'runId' = $${params.length}`);
  }
  params.push(Math.min(500, Math.max(1, Math.round(limit))));

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await queryPostgres(
      `
        SELECT id, terminal_id, event_type, severity, message, payload, created_at
        FROM ea_comm_events
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}
      `,
      params,
    );
    return (result.rows as any[]).map((row) => ({
      id: String(row.id),
      terminalId: row.terminal_id ? String(row.terminal_id) : null,
      eventType: String(row.event_type),
      severity: String(row.severity),
      message: String(row.message),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}

async function findRunEvent(runId: string, eventType: string): Promise<any | null> {
  if (!(await hasEaCommEventsTable())) return null;
  try {
    const result = await queryPostgres(
      `
        SELECT payload, created_at
        FROM ea_comm_events
        WHERE event_type = $1
          AND payload->>'runId' = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [eventType, runId],
    );
    return (result.rows[0] as any) ?? null;
  } catch {
    return null;
  }
}

async function logAutoTest(runId: string, terminalId: string | null, severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', eventType: string, message: string, payload: Record<string, unknown> = {}) {
  await appendEaCommEvent({
    terminalId,
    direction: 'OUTBOUND',
    channel: 'COMMAND',
    eventType,
    severity,
    message,
    payload: { runId, ...payload },
  });
}

async function enqueueAutoTestOrder(input: {
  runId: string;
  terminalId: string;
  symbol: 'EURUSD' | 'XAUUSD';
}): Promise<{ commandId: string }> {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const commandId = `${input.terminalId}-AUTO-TEST-${randomUUID()}`;
  const dedupeKey = `AUTO_TEST_RUNNER:${input.runId}:${input.terminalId}:${input.symbol}:BUY:0.01:SANDBOX:DEMO`;

  const payload = {
    type: 'PLACE_ORDER',
    source: 'AUTO_TEST_RUNNER',
    runId: input.runId,
    mode: 'SANDBOX',
    environment: 'DEMO',
    symbol: input.symbol,
    side: 'BUY',
    orderType: 'MARKET',
    volume: 0.01,
    sl: 0,
    tp: 0,
    comment: 'Cacsms Trader automatic sandbox test',
  } as Record<string, unknown>;

  const { command } = await dispatchExecutionCommand({
    commandId,
    terminalId: input.terminalId,
    type: 'place_order',
    payload,
    createdAt,
    expiresAt,
    environment: 'DEMO',
    sandboxMode: true,
    dedupeKey,
    maxAttempts: 1,
    intentId: `AUTO_TEST:${input.runId}`,
    source: 'AUTO_TEST_RUNNER',
  });

  await appendExecutionEvent({
    commandId: command.commandId,
    terminalId: command.terminalId,
    lifecycleState: 'ROUTING',
    eventType: 'ROUTED',
    severity: 'INFO',
    message: 'Auto-test command routed to MT5 bridge queue.',
    payload: { bridgeUrl: bridgeUrl() },
  }).catch(() => null);

  return { commandId: command.commandId };
}

export async function enableAutoExecutionTestRunner(): Promise<{ ok: true; runId: string }> {
  if (!(await hasEaCommEventsTable())) {
    throw new Error('relation "ea_comm_events" does not exist (run migration 006_ea_communication_engine.sql).');
  }
  const runId = randomUUID();
  const maxSpreadPoints = envNumber('CACSMS_AUTO_TEST_MAX_SPREAD_POINTS', 30);
  const delaySeconds = envNumber('CACSMS_AUTO_TEST_DELAY_SECONDS', 30);
  const heartbeatFreshMs = envNumber('CACSMS_AUTO_TEST_HEARTBEAT_FRESH_MS', 5000);

  await appendEaCommEvent({
    terminalId: null,
    direction: 'OUTBOUND',
    channel: 'COMMAND',
    eventType: 'AUTO_TEST_ENABLED',
    severity: 'INFO',
    message: 'Auto test enabled',
    payload: {
      runId,
      enabledAt: nowIso(),
      maxSpreadPoints,
      delaySeconds,
      heartbeatFreshMs,
      mode: 'SANDBOX',
      environment: 'DEMO',
    },
  });

  return { ok: true, runId };
}

export async function disableAutoExecutionTestRunner(reason: 'manual' | 'success' | 'failure' = 'manual'): Promise<{ ok: true }> {
  if (!(await hasEaCommEventsTable())) {
    return { ok: true };
  }
  const lastEnabled = await getLastEnabledRun();
  const runId = lastEnabled.runId ?? randomUUID();
  const eventType: AutoTestToggleEventType =
    reason === 'success' ? 'AUTO_TEST_DISABLED_AFTER_SUCCESS' : 'AUTO_TEST_DISABLED';

  await appendEaCommEvent({
    terminalId: null,
    direction: 'OUTBOUND',
    channel: 'COMMAND',
    eventType,
    severity: 'INFO',
    message: reason === 'success' ? 'Auto test disabled after success' : 'Auto test disabled',
    payload: { runId, disabledAt: nowIso(), reason },
  });

  return { ok: true };
}

export async function tickAutoExecutionTestRunner(input: { bridgeOnline: boolean; terminals: BridgeTerminal[] }): Promise<void> {
  await reconcileBridgeExecutionState().catch(() => null);
  const maxSpreadPoints = envNumber('CACSMS_AUTO_TEST_MAX_SPREAD_POINTS', 30);
  const delaySeconds = envNumber('CACSMS_AUTO_TEST_DELAY_SECONDS', 30);
  const heartbeatFreshMs = envNumber('CACSMS_AUTO_TEST_HEARTBEAT_FRESH_MS', 5000);
  const executionGateOk = isExecutionEnabled();

  const toggle = await getLastToggle();
  if (toggle.type !== 'AUTO_TEST_ENABLED' || !toggle.runId) return;
  const runId = toggle.runId;
  if (await hasExecutedAutoTest(runId)) {
    await disableAutoExecutionTestRunner('success').catch(() => null);
    return;
  }

  const terminal = input.terminals.find((t) => t.status === 'connected' && Number(t.heartbeatAgeMs ?? 0) <= heartbeatFreshMs) ?? null;
  if (!input.bridgeOnline || !terminal) {
    const already = await findRunEvent(runId, 'AUTO_TEST_WAITING_FOR_TERMINAL');
    if (!already) {
      await logAutoTest(runId, null, 'INFO', 'AUTO_TEST_WAITING_FOR_TERMINAL', 'Waiting for terminal', {
        bridgeOnline: input.bridgeOnline,
        detectedAt: nowIso(),
      }).catch(() => null);
    }
    return;
  }

  const terminalId = terminal.terminalId;
  const heartbeatFresh = terminal.heartbeatAgeMs <= heartbeatFreshMs;
  const accountType = normalizeAccountType(terminal.accountType);
  const assumedDemo = accountType === 'unknown' && String(process.env.NEXT_PUBLIC_TRADING_MODE ?? '').trim().toLowerCase() === 'demo';
  const enableExecution = Boolean(terminal.enableExecution);
  const accountTradeAllowed = terminal.accountTradeAllowed == null ? true : Boolean(terminal.accountTradeAllowed);
  const terminalTradeAllowed = terminal.terminalTradeAllowed == null ? true : Boolean(terminal.terminalTradeAllowed);
  const openOrders = Number(terminal.openOrders ?? 0);
  const symbolChoice = pickSymbol(terminal, maxSpreadPoints);

  const onlineEvent = await findRunEvent(runId, 'AUTO_TEST_TERMINAL_ONLINE');
  if (!onlineEvent) {
    await logAutoTest(runId, terminalId, 'INFO', 'AUTO_TEST_TERMINAL_ONLINE', 'Terminal online detected', {
      terminalId,
      detectedAt: nowIso(),
      heartbeatAgeMs: terminal.heartbeatAgeMs,
      accountType: terminal.accountType ?? null,
    }).catch(() => null);
    return;
  }

  const detectedAt = String(((onlineEvent.payload ?? {}) as any)?.detectedAt ?? '').trim();
  const detectedAtMs = Date.parse(detectedAt);
  const elapsedMs = Number.isFinite(detectedAtMs) ? Math.max(0, Date.now() - detectedAtMs) : 0;
  if (elapsedMs < delaySeconds * 1000) return;

  const dispatched = await findRunEvent(runId, 'AUTO_TEST_DISPATCHED');
  const commandIdFromLog = dispatched ? String(((dispatched.payload ?? {}) as any)?.commandId ?? '').trim() : '';
  const existingCommand = commandIdFromLog ? await queryPostgres(`SELECT * FROM execution_commands WHERE command_id = $1`, [commandIdFromLog]).then((r) => r.rows[0] as any).catch(() => null) : null;

  if (existingCommand) {
    const lifecycle = String(existingCommand.lifecycle_state ?? '').toUpperCase();
    if (lifecycle === 'EXECUTED') {
      const done = await findRunEvent(runId, 'AUTO_TEST_EXECUTED');
      if (!done) {
        await logAutoTest(runId, terminalId, 'SUCCESS', 'AUTO_TEST_EXECUTED', 'Automatic order executed', {
          commandId: commandIdFromLog,
          ticket: existingCommand.ticket ?? null,
        }).catch(() => null);
      }
      await disableAutoExecutionTestRunner('success').catch(() => null);
      return;
    }
    if (lifecycle === 'ACKNOWLEDGED') {
      const ack = await findRunEvent(runId, 'AUTO_TEST_ACKNOWLEDGED');
      if (!ack) {
        await logAutoTest(runId, terminalId, 'INFO', 'AUTO_TEST_ACKNOWLEDGED', 'Command acknowledged', {
          commandId: commandIdFromLog,
          ticket: existingCommand.ticket ?? null,
          ackStatus: existingCommand.ack_status ?? null,
        }).catch(() => null);
      }
      return;
    }
    if (lifecycle === 'FAILED' || lifecycle === 'TIMEOUT' || lifecycle === 'CANCELLED') {
      const fail = await findRunEvent(runId, 'AUTO_TEST_FAILED');
      if (!fail) {
        await logAutoTest(runId, terminalId, 'ERROR', 'AUTO_TEST_FAILED', 'Automatic order failed', {
          commandId: commandIdFromLog,
          lifecycleState: lifecycle,
          lastError: existingCommand.last_error ?? null,
          brokerMessage: existingCommand.broker_message ?? null,
          ackStatus: existingCommand.ack_status ?? null,
        }).catch(() => null);
      }
      await disableAutoExecutionTestRunner('failure').catch(() => null);
      return;
    }
    return;
  }

  const safety: Array<{ name: string; ok: boolean; detail: string }> = [
    { name: 'Bridge online', ok: input.bridgeOnline, detail: input.bridgeOnline ? 'Bridge reachable.' : 'Bridge unreachable.' },
    { name: 'Execution gate', ok: executionGateOk, detail: executionGateOk ? 'CACSMS_ENABLE_EXECUTION=true' : 'CACSMS_ENABLE_EXECUTION is false.' },
    { name: 'Terminal online', ok: terminal.status === 'connected', detail: `Terminal status: ${terminal.status}` },
    { name: 'Heartbeat fresh', ok: heartbeatFresh, detail: `Heartbeat age ${Math.round(terminal.heartbeatAgeMs)}ms (limit ${heartbeatFreshMs}ms).` },
    { name: 'Account DEMO', ok: accountType === 'demo' || assumedDemo, detail: assumedDemo ? 'Account type telemetry missing; assuming DEMO because NEXT_PUBLIC_TRADING_MODE=demo.' : `Account type: ${terminal.accountType ?? 'unknown'}` },
    { name: 'EA EnableExecution', ok: enableExecution, detail: enableExecution ? 'EnableExecution=true' : 'EnableExecution=false' },
    { name: 'Trade allowed', ok: accountTradeAllowed && terminalTradeAllowed, detail: `Account allowed=${accountTradeAllowed}, Terminal allowed=${terminalTradeAllowed}` },
    { name: 'No open orders', ok: openOrders === 0, detail: `Open orders: ${openOrders}` },
    { name: 'Spread & symbol', ok: Boolean(symbolChoice.symbol), detail: symbolChoice.reason },
  ];

  const ok = safety.every((s) => s.ok);
  if (!ok) {
    const already = await findRunEvent(runId, 'AUTO_TEST_SAFETY_BLOCKED');
    if (!already) {
      await logAutoTest(runId, terminalId, 'WARNING', 'AUTO_TEST_SAFETY_BLOCKED', 'Safety checks failed', {
        terminalId,
        checks: safety,
      }).catch(() => null);
    }
    return;
  }

  await logAutoTest(runId, terminalId, 'INFO', 'AUTO_TEST_SAFETY_PASSED', 'Safety checks passed', {
    terminalId,
    checks: safety,
  }).catch(() => null);

  try {
    await logAutoTest(runId, terminalId, 'INFO', 'AUTO_TEST_DISPATCHING', 'Dispatching automatic PLACE_ORDER', {
      terminalId,
      symbol: symbolChoice.symbol,
      volume: 0.01,
    }).catch(() => null);

    const dispatch = await enqueueAutoTestOrder({ runId, terminalId, symbol: symbolChoice.symbol as any });
    await logAutoTest(runId, terminalId, 'INFO', 'AUTO_TEST_DISPATCHED', 'Auto-test command enqueued', {
      terminalId,
      commandId: dispatch.commandId,
    }).catch(() => null);
  } catch (error) {
    await logAutoTest(runId, terminalId, 'ERROR', 'AUTO_TEST_FAILED', 'Automatic order failed', {
      terminalId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }).catch(() => null);
    await disableAutoExecutionTestRunner('failure').catch(() => null);
  }
}

export async function getAutoExecutionTestStatus(bridge?: { bridgeOnline: boolean; terminals: BridgeTerminal[] }): Promise<AutoTestStatusPayload> {
  const maxSpreadPoints = envNumber('CACSMS_AUTO_TEST_MAX_SPREAD_POINTS', 30);
  const delaySeconds = envNumber('CACSMS_AUTO_TEST_DELAY_SECONDS', 30);
  const heartbeatFreshMs = envNumber('CACSMS_AUTO_TEST_HEARTBEAT_FRESH_MS', 5000);
  const executionGateOk = isExecutionEnabled();
  const hasEvents = await hasEaCommEventsTable();

  const toggle = await getLastToggle();
  const runId = toggle.type === 'AUTO_TEST_ENABLED' ? toggle.runId : (await getLastEnabledRun()).runId;
  const executedForRun = await hasExecutedAutoTest(runId ?? null);
  const enabled = toggle.type === 'AUTO_TEST_ENABLED' && !executedForRun;

  if (executedForRun && toggle.type !== 'AUTO_TEST_DISABLED_AFTER_SUCCESS') {
    await disableAutoExecutionTestRunner('success').catch(() => null);
  }

  const logs = await listAutoTestLogs(runId ?? null, 120).catch(() => []);
  const lastCommand = await getLatestAutoTestCommand(runId ?? null).catch(() => null);
  const lastLifecycle = lastCommand ? String(lastCommand.lifecycle_state ?? '').toUpperCase() : '';

  const dispatchedLog = runId ? await findRunEvent(runId, 'AUTO_TEST_DISPATCHED').catch(() => null) : null;
  const commandId = dispatchedLog ? String(((dispatchedLog.payload ?? {}) as any)?.commandId ?? '') || null : (lastCommand ? String(lastCommand.command_id ?? '') : null);
  const ticket = lastCommand?.ticket ? String(lastCommand.ticket) : null;

  const onlineLog = runId ? await findRunEvent(runId, 'AUTO_TEST_TERMINAL_ONLINE').catch(() => null) : null;
  const terminalId = onlineLog ? String(((onlineLog.payload ?? {}) as any)?.terminalId ?? '') || null : null;
  const detectedAt = onlineLog ? String(((onlineLog.payload ?? {}) as any)?.detectedAt ?? '') : '';
  const detectedAtMs = Date.parse(detectedAt);
  const elapsedMs = Number.isFinite(detectedAtMs) ? Math.max(0, Date.now() - detectedAtMs) : 0;
  const countdownSeconds = enabled && terminalId ? Math.max(0, delaySeconds - Math.floor(elapsedMs / 1000)) : null;

  const bridgeTerminals = bridge?.terminals ?? [];
  const terminal =
    (terminalId ? bridgeTerminals.find((t) => t.terminalId === terminalId) : null)
    ?? pickBestBridgeTerminal(bridgeTerminals, heartbeatFreshMs);
  const heartbeatFresh = terminal ? Number(terminal.heartbeatAgeMs ?? 0) <= heartbeatFreshMs && terminal.status === 'connected' : false;
  const accountType = terminal ? normalizeAccountType(terminal.accountType) : 'unknown';
  const assumedDemo = accountType === 'unknown' && String(process.env.NEXT_PUBLIC_TRADING_MODE ?? '').trim().toLowerCase() === 'demo';
  const enableExecution = terminal ? Boolean(terminal.enableExecution) : false;
  const accountTradeAllowed = terminal ? (terminal.accountTradeAllowed == null ? true : Boolean(terminal.accountTradeAllowed)) : false;
  const terminalTradeAllowed = terminal ? (terminal.terminalTradeAllowed == null ? true : Boolean(terminal.terminalTradeAllowed)) : false;
  const openOrders = terminal ? Number(terminal.openOrders ?? 0) : 0;
  const symbolChoice = terminal ? pickSymbol(terminal, maxSpreadPoints) : { symbol: null, reason: 'No terminal telemetry.' };
  const bridgeOnline = bridge ? Boolean(bridge.bridgeOnline) : false;

  const safetyChecks: Array<{ name: string; ok: boolean; detail: string }> = [
    { name: 'Event log table', ok: hasEvents, detail: hasEvents ? 'ea_comm_events table exists.' : 'Missing ea_comm_events table. Run migration 006_ea_communication_engine.sql.' },
    { name: 'Bridge online', ok: bridgeOnline, detail: bridgeOnline ? 'Bridge reachable.' : 'Bridge unreachable.' },
    { name: 'Execution gate', ok: executionGateOk, detail: executionGateOk ? 'CACSMS_ENABLE_EXECUTION=true' : 'CACSMS_ENABLE_EXECUTION is false.' },
    {
      name: 'Terminal online',
      ok: Boolean(terminal) && terminal?.status === 'connected',
      detail: describeTerminalPresence(terminal, heartbeatFreshMs),
    },
    {
      name: 'Heartbeat fresh',
      ok: heartbeatFresh,
      detail: terminal
        ? `Heartbeat age ${Math.round(Number(terminal.heartbeatAgeMs ?? 0))}ms (limit ${heartbeatFreshMs}ms, status ${terminal.status}).`
        : 'No heartbeat telemetry.',
    },
    { name: 'Account DEMO', ok: accountType === 'demo' || assumedDemo, detail: assumedDemo ? 'Account type telemetry missing; assuming DEMO because NEXT_PUBLIC_TRADING_MODE=demo.' : terminal ? `Account type: ${terminal.accountType ?? 'unknown'}` : 'No account type telemetry.' },
    {
      name: 'EA EnableExecution',
      ok: enableExecution,
      detail: terminal
        ? (enableExecution ? 'EnableExecution=true in last EA heartbeat.' : 'EnableExecution=false in last EA heartbeat. Set EnableExecution=true in MT5 inputs and re-attach the EA.')
        : 'No EA telemetry yet.',
    },
    { name: 'Trade allowed', ok: accountTradeAllowed && terminalTradeAllowed, detail: `Account allowed=${accountTradeAllowed}, Terminal allowed=${terminalTradeAllowed}` },
    { name: 'No open orders', ok: openOrders === 0, detail: `Open orders: ${openOrders}` },
    { name: 'Spread & symbol', ok: Boolean(symbolChoice.symbol), detail: symbolChoice.reason },
  ];

  let state: AutoTestRunnerState = 'IDLE';
  if (executedForRun) state = 'DISABLED_AFTER_SUCCESS';
  else if (lastLifecycle === 'EXECUTED') state = 'EXECUTED';
  else if (!enabled) state = 'IDLE';
  else if (lastLifecycle === 'ACKNOWLEDGED') state = 'ACKNOWLEDGED';
  else if (lastLifecycle === 'FAILED' || lastLifecycle === 'TIMEOUT' || lastLifecycle === 'CANCELLED') state = 'FAILED';
  else if (lastCommand) state = 'DISPATCHING';
  else if (!bridgeOnline || !terminal || terminal.status !== 'connected') state = 'WAITING_FOR_TERMINAL';
  else if (countdownSeconds != null && countdownSeconds > 0) state = 'WAITING_FOR_TERMINAL';
  else if (!safetyChecks.every((s) => s.ok)) state = 'VALIDATING';
  else state = 'READY';

  const lastMessage =
    lastCommand?.last_error
      ? String(lastCommand.last_error)
      : lastCommand?.broker_message
        ? String(lastCommand.broker_message)
        : null;

  const lastResult = {
    state,
    commandId,
    ticket,
    message: lastMessage,
    updatedAt: lastCommand?.last_updated_at ? new Date(lastCommand.last_updated_at).toISOString() : lastCommand?.created_at ? new Date(lastCommand.created_at).toISOString() : null,
  };

  return {
    enabled,
    state,
    runId: runId ?? null,
    terminalId: terminalId ?? terminal?.terminalId ?? null,
    countdownSeconds,
    safetyChecks,
    lastResult,
    logs,
  };
}

export async function fetchBridgeTerminalOperations(): Promise<{ bridgeOnline: boolean; terminals: BridgeTerminal[] }> {
  try {
    const response = await fetch(`${bridgeUrl()}/terminal-operations`, {
      cache: 'no-store',
      headers: bridgeSecretHeader(),
    });
    if (!response.ok) return { bridgeOnline: false, terminals: [] };
    const payload = await response.json().catch(() => ({} as any));
    const terminals = Array.isArray(payload?.terminals) ? payload.terminals : [];
    return { bridgeOnline: true, terminals };
  } catch {
    return { bridgeOnline: false, terminals: [] };
  }
}

