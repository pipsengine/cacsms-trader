import crypto from 'node:crypto';
import { queryPostgres } from '@/lib/postgres';

export type ExecutionEnvironment = 'DEMO' | 'LIVE' | 'PROP' | 'MARKET_DATA_MONITOR' | 'FAILOVER_RESERVE';

export type ExecutionLifecycleState =
  | 'QUEUED'
  | 'ROUTING'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'EXECUTED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

export type ExecutionEventSeverity = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export type ExecutionCommandRecord = {
  commandId: string;
  terminalId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  lifecycleState: ExecutionLifecycleState;
  environment: ExecutionEnvironment;
  sandboxMode: boolean;
  dedupeKey: string | null;
  maxAttempts: number;
  attemptCount: number;
  routedTerminalId: string | null;
  routedAt: string | null;
  sentAt: string | null;
  ackStatus: string | null;
  brokerMessage: string | null;
  ticket: string | null;
  executedPrice: number | null;
  executedVolumeLots: number | null;
  slippagePoints: number | null;
  spreadPoints: number | null;
  symbol: string | null;
  side: string | null;
  lastError: string | null;
  lastUpdatedAt: string;
};

export type ExecutionCommandEvent = {
  id: string;
  commandId: string;
  terminalId: string | null;
  lifecycleState: ExecutionLifecycleState;
  eventType: string;
  severity: ExecutionEventSeverity;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type EnqueueExecutionCommandInput = {
  commandId: string;
  terminalId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  environment: ExecutionEnvironment;
  sandboxMode: boolean;
  dedupeKey?: string;
  maxAttempts?: number;
};

export type DispatchEventInput = {
  terminalId: string;
  command: {
    commandId: string;
    terminalId: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
    expiresAt: string;
    attempt?: number;
    leaseExpiresAt?: string;
  };
  dispatchedAt: string;
};

export type AckEventInput = {
  commandId: string;
  terminalId: string;
  status: string;
  ticket?: string;
  brokerMessage?: string;
  executedPrice?: number | null;
  executedVolumeLots?: number | null;
  slippagePoints?: number | null;
  spreadPoints?: number | null;
  latencyMs?: number | null;
  receivedAt?: string;
};

type ExecutionBridgeSchemaCapabilities = {
  hasLifecycleState: boolean;
  hasEnvironment: boolean;
  hasSandboxMode: boolean;
  hasDedupeKey: boolean;
  hasEventsTable: boolean;
};

let schemaCache: { caps: ExecutionBridgeSchemaCapabilities; loadedAt: number } | null = null;

async function getSchemaCaps(): Promise<ExecutionBridgeSchemaCapabilities> {
  const now = Date.now();
  if (schemaCache && now - schemaCache.loadedAt < 30_000) return schemaCache.caps;

  try {
    const result = await queryPostgres(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'execution_commands'
              AND column_name = 'lifecycle_state'
          ) AS has_lifecycle_state,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'execution_commands'
              AND column_name = 'environment'
          ) AS has_environment,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'execution_commands'
              AND column_name = 'sandbox_mode'
          ) AS has_sandbox_mode,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'execution_commands'
              AND column_name = 'dedupe_key'
          ) AS has_dedupe_key,
          to_regclass('public.execution_command_events') IS NOT NULL AS has_events_table
      `,
    );

    const row = result.rows[0] as any;
    const caps: ExecutionBridgeSchemaCapabilities = {
      hasLifecycleState: Boolean(row?.has_lifecycle_state),
      hasEnvironment: Boolean(row?.has_environment),
      hasSandboxMode: Boolean(row?.has_sandbox_mode),
      hasDedupeKey: Boolean(row?.has_dedupe_key),
      hasEventsTable: Boolean(row?.has_events_table),
    };
    schemaCache = { caps, loadedAt: now };
    return caps;
  } catch {
    const caps: ExecutionBridgeSchemaCapabilities = {
      hasLifecycleState: false,
      hasEnvironment: false,
      hasSandboxMode: false,
      hasDedupeKey: false,
      hasEventsTable: false,
    };
    schemaCache = { caps, loadedAt: now };
    return caps;
  }
}

export async function upsertExecutionCommand(input: EnqueueExecutionCommandInput): Promise<{ command: ExecutionCommandRecord; inserted: boolean }> {
  const caps = await getSchemaCaps();
  const normalized = normalizeEnqueue(input);
  const symbol = text(normalized.payload.symbol);
  const side = text(normalized.payload.side);

  const insert = caps.hasLifecycleState
    ? await queryPostgres(
        `
          INSERT INTO execution_commands (
            command_id,
            terminal_id,
            type,
            payload,
            status,
            created_at,
            expires_at,
            lifecycle_state,
            environment,
            sandbox_mode,
            dedupe_key,
            max_attempts,
            attempt_count,
            symbol,
            side,
            last_updated_at
          )
          VALUES ($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,$10,$11,0,$12,$13,now())
          ON CONFLICT (command_id) DO UPDATE SET
            terminal_id = EXCLUDED.terminal_id,
            type = EXCLUDED.type,
            payload = EXCLUDED.payload,
            expires_at = EXCLUDED.expires_at,
            environment = EXCLUDED.environment,
            sandbox_mode = EXCLUDED.sandbox_mode,
            dedupe_key = COALESCE(EXCLUDED.dedupe_key, execution_commands.dedupe_key),
            max_attempts = GREATEST(execution_commands.max_attempts, EXCLUDED.max_attempts),
            symbol = COALESCE(EXCLUDED.symbol, execution_commands.symbol),
            side = COALESCE(EXCLUDED.side, execution_commands.side),
            last_updated_at = now()
          RETURNING *, (xmax = 0) AS inserted
        `,
        [
          normalized.commandId,
          normalized.terminalId,
          normalized.type,
          JSON.stringify(normalized.payload),
          normalized.createdAt,
          normalized.expiresAt,
          'QUEUED',
          normalized.environment,
          normalized.sandboxMode,
          normalized.dedupeKey,
          normalized.maxAttempts,
          symbol || null,
          side || null,
        ],
      )
    : await queryPostgres(
        `
          INSERT INTO execution_commands (
            command_id,
            terminal_id,
            type,
            payload,
            status,
            created_at,
            expires_at
          )
          VALUES ($1,$2,$3,$4,'queued',$5,$6)
          ON CONFLICT (command_id) DO UPDATE SET
            terminal_id = EXCLUDED.terminal_id,
            type = EXCLUDED.type,
            payload = EXCLUDED.payload,
            expires_at = EXCLUDED.expires_at
          RETURNING *, (xmax = 0) AS inserted
        `,
        [
          normalized.commandId,
          normalized.terminalId,
          normalized.type,
          JSON.stringify(normalized.payload),
          normalized.createdAt,
          normalized.expiresAt,
        ],
      );

  const row = insert.rows[0] as any;
  const inserted = Boolean(row.inserted);
  if (inserted) {
    await appendExecutionEvent({
      commandId: normalized.commandId,
      terminalId: normalized.terminalId,
      lifecycleState: 'QUEUED',
      eventType: 'ENQUEUE',
      severity: 'INFO',
      message: `Command queued for ${normalized.terminalId}.`,
      payload: { type: normalized.type, environment: normalized.environment, sandboxMode: normalized.sandboxMode },
    }).catch(() => null);
  }

  return { command: mapCommand(row), inserted };
}

export async function recordDispatch(input: DispatchEventInput): Promise<void> {
  const caps = await getSchemaCaps();
  const dispatchedAt = iso(input.dispatchedAt) ?? new Date().toISOString();
  const attempt = numberOrNull(input.command.attempt) ?? 0;
  if (caps.hasLifecycleState) {
    await queryPostgres(
      `
        UPDATE execution_commands
        SET lifecycle_state = 'SENT',
            routed_terminal_id = $2,
            routed_at = COALESCE(routed_at, $3::timestamptz),
            sent_at = $3::timestamptz,
            attempt_count = GREATEST(attempt_count, $4),
            last_updated_at = now()
        WHERE command_id = $1
      `,
      [input.command.commandId, input.terminalId, dispatchedAt, attempt],
    );
  } else {
    await queryPostgres(
      `
        UPDATE execution_commands
        SET status = 'sent'
        WHERE command_id = $1
      `,
      [input.command.commandId],
    );
  }

  await appendExecutionEvent({
    commandId: input.command.commandId,
    terminalId: input.terminalId,
    lifecycleState: 'SENT',
    eventType: 'DISPATCH',
    severity: 'INFO',
    message: `Command dispatched to EA (attempt ${attempt}).`,
    payload: { leaseExpiresAt: input.command.leaseExpiresAt ?? '', attempt },
  }).catch(() => null);
}

export async function recordAck(input: AckEventInput): Promise<void> {
  const caps = await getSchemaCaps();
  const receivedAt = iso(input.receivedAt) ?? new Date().toISOString();
  const status = String(input.status ?? '').toLowerCase();
  const mappedState = mapAckToLifecycle(status);

  if (caps.hasLifecycleState) {
    await queryPostgres(
      `
        UPDATE execution_commands
        SET lifecycle_state = $2,
            ack_status = $3,
            broker_message = $4,
            ticket = $5,
            executed_price = $6,
            executed_volume_lots = $7,
            slippage_points = COALESCE($8, slippage_points),
            spread_points = COALESCE($9, spread_points),
            acknowledged_at = $10::timestamptz,
            last_updated_at = now(),
            last_error = CASE
              WHEN $2 = 'EXECUTED' THEN NULL
              WHEN $2 IN ('FAILED','TIMEOUT') THEN COALESCE($4, last_error)
              ELSE last_error
            END
        WHERE command_id = $1
      `,
      [
        input.commandId,
        mappedState,
        status || null,
        text(input.brokerMessage) || null,
        text(input.ticket) || null,
        numberOrNull(input.executedPrice),
        numberOrNull(input.executedVolumeLots),
        numberOrNull(input.slippagePoints),
        numberOrNull(input.spreadPoints),
        receivedAt,
      ],
    );
  } else {
    const legacyStatus = mappedState === 'EXECUTED' || mappedState === 'ACKNOWLEDGED' ? 'acknowledged' : mappedState === 'FAILED' ? 'failed' : mappedState === 'CANCELLED' ? 'cancelled' : mappedState === 'TIMEOUT' ? 'expired' : 'acknowledged';
    await queryPostgres(
      `
        UPDATE execution_commands
        SET status = $2,
            acknowledged_at = $3::timestamptz
        WHERE command_id = $1
      `,
      [input.commandId, legacyStatus, receivedAt],
    );
  }

  await appendExecutionEvent({
    commandId: input.commandId,
    terminalId: input.terminalId,
    lifecycleState: mappedState,
    eventType: 'ACK',
    severity: mappedState === 'EXECUTED' ? 'SUCCESS' : mappedState === 'FAILED' || mappedState === 'TIMEOUT' ? 'ERROR' : mappedState === 'CANCELLED' ? 'WARNING' : 'INFO',
    message: `Ack ${status || 'unknown'} received.`,
    payload: {
      ticket: text(input.ticket),
      brokerMessage: text(input.brokerMessage),
      executedPrice: numberOrNull(input.executedPrice),
      executedVolumeLots: numberOrNull(input.executedVolumeLots),
      slippagePoints: numberOrNull(input.slippagePoints),
      spreadPoints: numberOrNull(input.spreadPoints),
      latencyMs: numberOrNull(input.latencyMs),
      receivedAt,
    },
  }).catch(() => null);

  await syncOpenPositionFromAck({
    commandId: input.commandId,
    terminalId: input.terminalId,
    mappedState,
    status,
    ticket: text(input.ticket),
    executedPrice: numberOrNull(input.executedPrice),
    executedVolumeLots: numberOrNull(input.executedVolumeLots),
  }).catch(() => null);
}

async function syncOpenPositionFromAck(input: {
  commandId: string;
  terminalId: string;
  mappedState: ExecutionLifecycleState;
  status: string;
  ticket: string | null;
  executedPrice: number | null;
  executedVolumeLots: number | null;
}): Promise<void> {
  const { trackOpenPositionFromFill, markPositionClosed } = await import('@/lib/execution-open-positions');
  const command = await queryPostgres(`SELECT type, payload, symbol, side FROM execution_commands WHERE command_id = $1 LIMIT 1`, [
    input.commandId,
  ]).catch(() => ({ rows: [] as Array<{ type?: string; payload?: Record<string, unknown>; symbol?: string; side?: string }> }));
  const row = command.rows[0];
  if (!row) return;

  const commandType = String(row.type ?? '').toLowerCase().replaceAll('-', '_');
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const ticket = input.ticket ?? String(payload.ticket ?? '').trim();

  if (
    commandType === 'place_order'
    && ticket
    && (input.mappedState === 'EXECUTED' || input.mappedState === 'ACKNOWLEDGED')
  ) {
    await trackOpenPositionFromFill({
      terminalId: input.terminalId,
      commandId: input.commandId,
      ticket,
      symbol: row.symbol ? String(row.symbol) : String(payload.symbol ?? ''),
      side: row.side ? String(row.side) : String(payload.side ?? ''),
      volumeLots: input.executedVolumeLots,
      entryPrice: input.executedPrice,
      stopLoss: Number(payload.sl ?? payload.stopLoss ?? 0) || null,
      takeProfit: Number(payload.tp ?? payload.takeProfit ?? 0) || null,
    });
    return;
  }

  if ((commandType === 'close_order' || commandType === 'emergency_close_all') && ticket && (input.status === 'accepted' || input.mappedState === 'EXECUTED')) {
    await markPositionClosed({ terminalId: input.terminalId, ticket, partial: false });
    return;
  }

  if (commandType === 'partial_close' && ticket && (input.status === 'accepted' || input.mappedState === 'EXECUTED')) {
    await markPositionClosed({ terminalId: input.terminalId, ticket, partial: true });
  }
}

export async function markTimeouts(now = new Date()): Promise<number> {
  const caps = await getSchemaCaps();
  if (caps.hasLifecycleState) {
    const ids: { command_id: string; terminal_id: string }[] = [];
    const expired = await queryPostgres(
        `
          UPDATE execution_commands
          SET lifecycle_state = 'TIMEOUT',
              last_error = COALESCE(last_error, 'timeout'),
              last_updated_at = now()
          WHERE lifecycle_state IN ('QUEUED','ROUTING','SENT')
            AND expires_at < $1::timestamptz
            AND ticket IS NULL
            AND COALESCE(ack_status, '') NOT IN ('filled', 'accepted')
          RETURNING command_id, terminal_id
        `,
        [now.toISOString()],
      );
    ids.push(...(expired.rows as any));

    const ackTimeout = await queryPostgres(
      `
        UPDATE execution_commands
        SET lifecycle_state = 'TIMEOUT',
            last_error = COALESCE(last_error, 'ack_timeout'),
            last_updated_at = now()
        WHERE lifecycle_state = 'SENT'
          AND acknowledged_at IS NULL
          AND sent_at IS NOT NULL
          AND sent_at < (now() - interval '5 seconds')
          AND expires_at > now()
          AND ticket IS NULL
          AND COALESCE(ack_status, '') NOT IN ('filled', 'accepted')
        RETURNING command_id, terminal_id
      `,
    );
    ids.push(...(ackTimeout.rows as any));

    const executionTimeout = await queryPostgres(
      `
        UPDATE execution_commands
        SET lifecycle_state = 'TIMEOUT',
            last_error = COALESCE(last_error, 'execution_timeout'),
            last_updated_at = now()
        WHERE lifecycle_state = 'ACKNOWLEDGED'
          AND COALESCE(ack_status, '') = 'accepted'
          AND COALESCE(broker_message, '') <> 'conditional_entry_waiting_for_retracement_confirmation'
          AND acknowledged_at IS NOT NULL
          AND acknowledged_at < (now() - interval '15 seconds')
          AND expires_at > now()
          AND ticket IS NULL
        RETURNING command_id, terminal_id
      `,
    );
    ids.push(...(executionTimeout.rows as any));

    const totalTimeout = await queryPostgres(
      `
        UPDATE execution_commands
        SET lifecycle_state = 'TIMEOUT',
            last_error = COALESCE(last_error, 'total_timeout'),
            last_updated_at = now()
        WHERE lifecycle_state IN ('QUEUED','ROUTING','SENT','ACKNOWLEDGED')
          AND created_at < (now() - interval '20 seconds')
          AND expires_at > now()
          AND ticket IS NULL
          AND COALESCE(ack_status, '') NOT IN ('filled', 'accepted')
        RETURNING command_id, terminal_id
      `,
    );
    ids.push(...(totalTimeout.rows as any));

    const deduped = new Map<string, { command_id: string; terminal_id: string }>();
    for (const row of ids) {
      const id = String((row as any).command_id ?? '');
      if (!id) continue;
      deduped.set(id, { command_id: String((row as any).command_id), terminal_id: String((row as any).terminal_id ?? '') });
    }

    await Promise.allSettled(
      Array.from(deduped.values()).map((row) =>
        appendExecutionEvent({
          commandId: String(row.command_id),
          terminalId: String(row.terminal_id ?? ''),
          lifecycleState: 'TIMEOUT',
          eventType: 'TIMEOUT',
          severity: 'ERROR',
          message: 'Execution timed out before completion.',
          payload: {},
        }).catch(() => null),
      ),
    );

    return deduped.size;
  }

  const result = await queryPostgres(
        `
          UPDATE execution_commands
          SET status = 'expired'
          WHERE status IN ('queued','sent','leased')
            AND expires_at < $1::timestamptz
            AND acknowledged_at IS NULL
          RETURNING command_id, terminal_id
        `,
        [now.toISOString()],
      );

  await Promise.allSettled(
    result.rows.map((row: any) =>
      appendExecutionEvent({
        commandId: String(row.command_id),
        terminalId: String(row.terminal_id ?? ''),
        lifecycleState: 'TIMEOUT',
        eventType: 'TIMEOUT',
        severity: 'ERROR',
        message: 'Execution timed out before ack.',
        payload: {},
      }).catch(() => null),
    ),
  );

  return result.rows.length;
}

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function reconcileBridgeExecutionState(): Promise<number> {
  let reconciled = 0;
  try {
    const response = await fetch(`${bridgeUrl()}/commands`, {
      cache: 'no-store',
      headers: bridgeSecretHeader(),
    });
    if (!response.ok) return 0;
    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    const commands = Array.isArray((payload as { commands?: unknown[] }).commands)
      ? (payload as { commands: unknown[] }).commands
      : [];

    for (const raw of commands) {
      const command = raw as Record<string, unknown>;
      const commandId = String(command.commandId ?? '').trim();
      const terminalId = String(command.terminalId ?? '').trim();
      if (!commandId || !terminalId) continue;

      const dispatchedAt = String(command.leasedAt ?? command.lastDispatchedAt ?? '').trim();
      if (dispatchedAt) {
        await recordDispatch({
          terminalId,
          dispatchedAt,
          command: {
            commandId,
            terminalId,
            type: String(command.type ?? ''),
            payload: (command.payload ?? {}) as Record<string, unknown>,
            createdAt: String(command.createdAt ?? dispatchedAt),
            expiresAt: String(command.expiresAt ?? dispatchedAt),
            attempt: Number(command.attempt ?? 1),
            leaseExpiresAt: String(command.leasedUntil ?? ''),
          },
        }).catch(() => null);
        reconciled += 1;
      }

      const ack = command.ack as Record<string, unknown> | null | undefined;
      if (ack && typeof ack === 'object') {
        await recordAck({
          commandId,
          terminalId,
          status: String(ack.status ?? ''),
          ticket: ack.ticket != null ? String(ack.ticket) : undefined,
          brokerMessage: ack.brokerMessage != null ? String(ack.brokerMessage) : undefined,
          executedPrice: ack.executedPrice != null ? Number(ack.executedPrice) : null,
          executedVolumeLots: ack.executedVolumeLots != null ? Number(ack.executedVolumeLots) : null,
          latencyMs: ack.latencyMs != null ? Number(ack.latencyMs) : null,
          receivedAt: String(ack.receivedAt ?? new Date().toISOString()),
        }).catch(() => null);
        reconciled += 1;
      }
    }
  } catch {
    return reconciled;
  }
  return reconciled;
}

export async function listExecutionCommands(filter: {
  terminalId?: string;
  environment?: ExecutionEnvironment;
  sandboxMode?: boolean;
  lifecycleState?: ExecutionLifecycleState;
  limit?: number;
}): Promise<ExecutionCommandRecord[]> {
  const caps = await getSchemaCaps();
  const limit = Math.min(500, Math.max(1, Number(filter.limit ?? 200)));
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter.terminalId) {
    params.push(filter.terminalId);
    conditions.push(`terminal_id = $${params.length}`);
  }
  if (caps.hasEnvironment && filter.environment) {
    params.push(filter.environment);
    conditions.push(`environment = $${params.length}`);
  }
  if (caps.hasSandboxMode && typeof filter.sandboxMode === 'boolean') {
    params.push(filter.sandboxMode);
    conditions.push(`sandbox_mode = $${params.length}`);
  }
  if (caps.hasLifecycleState && filter.lifecycleState) {
    params.push(filter.lifecycleState);
    conditions.push(`lifecycle_state = $${params.length}`);
  }

  params.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await queryPostgres(
    `
      SELECT *
      FROM execution_commands
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map((row: any) => mapCommand(row));
}

export async function listExecutionEvents(filter: { sinceId?: string; commandId?: string; limit?: number }): Promise<ExecutionCommandEvent[]> {
  const caps = await getSchemaCaps();
  if (!caps.hasEventsTable) return [];
  const limit = Math.min(500, Math.max(1, Number(filter.limit ?? 200)));
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter.commandId) {
    params.push(filter.commandId);
    conditions.push(`command_id = $${params.length}`);
  }
  if (filter.sinceId) {
    params.push(BigInt(filter.sinceId));
    conditions.push(`id > $${params.length}`);
  }

  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await queryPostgres(
      `
        SELECT *
        FROM execution_command_events
        ${where}
        ORDER BY id ASC
        LIMIT $${params.length}
      `,
      params,
    );
    return result.rows.map((row: any) => mapEvent(row));
  } catch {
    return [];
  }
}

export async function appendExecutionEvent(input: {
  commandId: string;
  terminalId: string;
  lifecycleState: ExecutionLifecycleState;
  eventType: string;
  severity: ExecutionEventSeverity;
  message: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const caps = await getSchemaCaps();
  if (!caps.hasEventsTable) return;
  await queryPostgres(
    `
      INSERT INTO execution_command_events (
        command_id,
        terminal_id,
        lifecycle_state,
        event_type,
        severity,
        message,
        payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      input.commandId,
      input.terminalId || null,
      input.lifecycleState,
      input.eventType,
      input.severity,
      input.message,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

function normalizeEnqueue(input: EnqueueExecutionCommandInput) {
  return {
    commandId: requiredText(input.commandId, 'commandId'),
    terminalId: requiredText(input.terminalId, 'terminalId'),
    type: requiredText(input.type, 'type'),
    payload: typeof input.payload === 'object' && input.payload ? input.payload : {},
    createdAt: iso(input.createdAt) ?? new Date().toISOString(),
    expiresAt: iso(input.expiresAt) ?? new Date(Date.now() + 60_000).toISOString(),
    environment: input.environment,
    sandboxMode: Boolean(input.sandboxMode),
    dedupeKey: input.dedupeKey ? text(input.dedupeKey) : null,
    maxAttempts: Number.isFinite(Number(input.maxAttempts)) ? Math.max(1, Math.min(10, Math.round(Number(input.maxAttempts)))) : 3,
  };
}

function mapCommand(row: any): ExecutionCommandRecord {
  const lifecycleState = resolveLifecycleState(row);
  const environment = row.environment ? String(row.environment) : 'DEMO';
  const sandboxMode = row.sandbox_mode == null ? true : Boolean(row.sandbox_mode);
  const lastUpdatedAt = row.last_updated_at
    ? new Date(row.last_updated_at).toISOString()
    : row.acknowledged_at
      ? new Date(row.acknowledged_at).toISOString()
      : row.created_at
        ? new Date(row.created_at).toISOString()
        : new Date().toISOString();

  return {
    commandId: String(row.command_id),
    terminalId: String(row.terminal_id),
    type: String(row.type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    lifecycleState,
    environment: environment as ExecutionEnvironment,
    sandboxMode,
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    maxAttempts: Number(row.max_attempts ?? 3),
    attemptCount: Number(row.attempt_count ?? 0),
    routedTerminalId: row.routed_terminal_id ? String(row.routed_terminal_id) : null,
    routedAt: row.routed_at ? new Date(row.routed_at).toISOString() : null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    ackStatus: row.ack_status ? String(row.ack_status) : null,
    brokerMessage: row.broker_message ? String(row.broker_message) : null,
    ticket: row.ticket ? String(row.ticket) : null,
    executedPrice: numberOrNull(row.executed_price),
    executedVolumeLots: numberOrNull(row.executed_volume_lots),
    slippagePoints: row.slippage_points == null ? null : Number(row.slippage_points),
    spreadPoints: row.spread_points == null ? null : Number(row.spread_points),
    symbol: row.symbol ? String(row.symbol) : null,
    side: row.side ? String(row.side) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    lastUpdatedAt,
  };
}

function resolveLifecycleState(row: any): ExecutionLifecycleState {
  const raw = row.lifecycle_state ? String(row.lifecycle_state) : '';
  if (raw === 'QUEUED' || raw === 'ROUTING' || raw === 'SENT' || raw === 'ACKNOWLEDGED' || raw === 'EXECUTED' || raw === 'FAILED' || raw === 'TIMEOUT' || raw === 'CANCELLED') {
    return raw as ExecutionLifecycleState;
  }
  const status = String(row.status ?? '').toLowerCase();
  if (status === 'queued') return 'QUEUED';
  if (status === 'leased' || status === 'sent') return 'SENT';
  if (status === 'acknowledged') return 'ACKNOWLEDGED';
  if (status === 'expired') return 'TIMEOUT';
  if (status === 'dead' || status === 'failed') return 'FAILED';
  if (status === 'cancelled' || status === 'canceled') return 'CANCELLED';
  if (row.acknowledged_at) return 'ACKNOWLEDGED';
  return 'QUEUED';
}

function mapEvent(row: any): ExecutionCommandEvent {
  return {
    id: String(row.id),
    commandId: String(row.command_id),
    terminalId: row.terminal_id ? String(row.terminal_id) : null,
    lifecycleState: String(row.lifecycle_state) as ExecutionLifecycleState,
    eventType: String(row.event_type),
    severity: String(row.severity) as ExecutionEventSeverity,
    message: String(row.message),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapAckToLifecycle(status: string): ExecutionLifecycleState {
  if (status === 'filled') return 'EXECUTED';
  if (status === 'failed') return 'FAILED';
  if (status === 'rejected') return 'CANCELLED';
  if (status === 'accepted') return 'ACKNOWLEDGED';
  if (status === 'sent') return 'SENT';
  if (status === 'queued') return 'QUEUED';
  return 'ACKNOWLEDGED';
}

function requiredText(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function stableDedupeKey(input: {
  terminalId: string;
  type: string;
  symbol?: string;
  side?: string;
  volumeLots?: number;
  intentId?: string;
  expiresAt?: string;
}): string {
  const base = [
    text(input.intentId),
    requiredText(input.terminalId, 'terminalId'),
    requiredText(input.type, 'type'),
    text(input.symbol).toUpperCase(),
    text(input.side).toLowerCase(),
    input.volumeLots == null ? '' : String(input.volumeLots),
    text(input.expiresAt),
  ].join('|');
  return crypto.createHash('sha256').update(base).digest('hex');
}
