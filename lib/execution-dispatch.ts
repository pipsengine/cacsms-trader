import crypto from 'node:crypto';
import {
  appendExecutionEvent,
  stableDedupeKey,
  upsertExecutionCommand,
  type EnqueueExecutionCommandInput,
  type ExecutionCommandRecord,
  type ExecutionEnvironment,
} from '@/lib/execution-bridge-store';
import {
  assertExecutionPolicy,
  defaultCommandExpiresAt,
  defaultMaxAttempts,
  ExecutionPolicyBlockedError,
  normalizeExecutionCommandType,
} from '@/lib/execution-policy';
import {
  assertExecutionRiskGate,
  ExecutionRiskBlockedError,
  isExecutionRiskGatedCommandType,
} from '@/lib/execution-risk-gate';
import { queryPostgres } from '@/lib/postgres';

export type DispatchExecutionCommandInput = {
  commandId?: string;
  terminalId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  expiresAt?: string;
  environment?: ExecutionEnvironment;
  sandboxMode?: boolean;
  dedupeKey?: string;
  maxAttempts?: number;
  intentId?: string;
  skipRiskGate?: boolean;
  source?: string;
};

export type DispatchExecutionCommandResult = {
  command: ExecutionCommandRecord;
  inserted: boolean;
  deduped?: boolean;
  bridge: Record<string, unknown>;
};

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

function rowToCommand(row: Record<string, unknown>): ExecutionCommandRecord {
  return {
    commandId: String(row.command_id),
    terminalId: String(row.terminal_id),
    type: String(row.type),
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    lifecycleState: String(row.lifecycle_state ?? 'QUEUED') as ExecutionCommandRecord['lifecycleState'],
    environment: String(row.environment ?? 'DEMO') as ExecutionEnvironment,
    sandboxMode: Boolean(row.sandbox_mode),
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    maxAttempts: Number(row.max_attempts ?? 3),
    attemptCount: Number(row.attempt_count ?? 0),
    routedTerminalId: row.routed_terminal_id ? String(row.routed_terminal_id) : null,
    routedAt: row.routed_at ? new Date(String(row.routed_at)).toISOString() : null,
    sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
    ackStatus: row.ack_status ? String(row.ack_status) : null,
    brokerMessage: row.broker_message ? String(row.broker_message) : null,
    ticket: row.ticket ? String(row.ticket) : null,
    executedPrice: row.executed_price == null ? null : Number(row.executed_price),
    executedVolumeLots: row.executed_volume_lots == null ? null : Number(row.executed_volume_lots),
    slippagePoints: row.slippage_points == null ? null : Number(row.slippage_points),
    spreadPoints: row.spread_points == null ? null : Number(row.spread_points),
    symbol: row.symbol ? String(row.symbol) : null,
    side: row.side ? String(row.side) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    lastUpdatedAt: row.last_updated_at ? new Date(String(row.last_updated_at)).toISOString() : new Date().toISOString(),
  };
}

export async function dispatchExecutionCommand(input: DispatchExecutionCommandInput): Promise<DispatchExecutionCommandResult> {
  const commandType = normalizeExecutionCommandType(input.type);
  const sandboxMode = Boolean(input.sandboxMode ?? true);
  const environment = String(input.environment ?? 'DEMO').toUpperCase() as ExecutionEnvironment;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt?.trim() ? input.expiresAt : defaultCommandExpiresAt(commandType);
  const commandId = String(input.commandId ?? crypto.randomUUID()).trim() || crypto.randomUUID();
  const payload: Record<string, unknown> = {
    ...input.payload,
    ...(input.source ? { source: input.source } : {}),
  };

  await assertExecutionPolicy({
    commandType,
    environment,
    sandboxMode,
  });

  const volume = Number(payload.volume ?? payload.volumeLots ?? NaN);
  if (!input.skipRiskGate && isExecutionRiskGatedCommandType(commandType)) {
    await assertExecutionRiskGate({
      terminalId: input.terminalId,
      commandId,
      intentId: input.intentId ?? (String(payload.intentId ?? '').trim() || undefined),
      requestedLots: Number.isFinite(volume) ? volume : 0,
      stopLoss: Number(payload.sl ?? payload.stopLoss ?? 0),
      takeProfit: Number(payload.tp ?? payload.takeProfit ?? 0),
      sandboxMode,
      environment,
    });
  }

  const dedupeKey =
    typeof input.dedupeKey === 'string' && input.dedupeKey.trim()
      ? input.dedupeKey.trim()
      : stableDedupeKey({
          terminalId: input.terminalId,
          type: commandType,
          symbol: String(payload.symbol ?? ''),
          side: String(payload.side ?? ''),
          volumeLots: Number.isFinite(volume) ? volume : Number(payload.volumeLots ?? NaN),
          intentId: String(payload.intentId ?? ''),
          expiresAt,
        });

  const enqueueInput: EnqueueExecutionCommandInput = {
    commandId,
    terminalId: input.terminalId,
    type: commandType,
    payload,
    createdAt,
    expiresAt,
    environment,
    sandboxMode,
    dedupeKey,
    maxAttempts: Number(input.maxAttempts ?? defaultMaxAttempts(commandType)),
  };

  let commandResult: { command: ExecutionCommandRecord; inserted: boolean };
  try {
    commandResult = await upsertExecutionCommand(enqueueInput);
  } catch (error: unknown) {
    if (String((error as { code?: string })?.code ?? '') === '23505') {
      const existing = await queryPostgres(
        `SELECT * FROM execution_commands WHERE dedupe_key = $1 ORDER BY created_at DESC LIMIT 1`,
        [dedupeKey],
      );
      const row = existing.rows[0] as Record<string, unknown> | undefined;
      if (row) {
        return {
          command: rowToCommand(row),
          inserted: false,
          deduped: true,
          bridge: {},
        };
      }
    }
    throw error;
  }

  const { command, inserted } = commandResult;

  const forward = await fetch(`${bridgeUrl()}/commands/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...bridgeSecretHeader(),
    },
    body: JSON.stringify({
      commandId: command.commandId,
      terminalId: command.terminalId,
      type: command.type,
      payload: command.payload,
      createdAt: command.createdAt,
      expiresAt: command.expiresAt,
    }),
  });

  if (!forward.ok) {
    const message = await forward.text();
    await queryPostgres(
      `
        UPDATE execution_commands
        SET last_error = $2,
            last_updated_at = now()
        WHERE command_id = $1
      `,
      [command.commandId, message || `Bridge enqueue failed with HTTP ${forward.status}`],
    ).catch(() => null);
    throw new Error(message || `Bridge enqueue failed with HTTP ${forward.status}`);
  }

  await queryPostgres(
    `
      UPDATE execution_commands
      SET lifecycle_state = 'ROUTING',
          routed_at = COALESCE(routed_at, now()),
          last_updated_at = now()
      WHERE command_id = $1
        AND lifecycle_state = 'QUEUED'
    `,
    [command.commandId],
  ).catch(() => null);

  await appendExecutionEvent({
    commandId: command.commandId,
    terminalId: command.terminalId,
    lifecycleState: 'ROUTING',
    eventType: 'ROUTED',
    severity: 'INFO',
    message: 'Command routed to MT5 bridge queue.',
    payload: { bridgeUrl: bridgeUrl(), inserted, source: input.source ?? null },
  }).catch(() => null);

  const bridgePayload = (await forward.json().catch(() => ({}))) as Record<string, unknown>;
  return { command, inserted, bridge: bridgePayload };
}

export { ExecutionPolicyBlockedError, ExecutionRiskBlockedError };
