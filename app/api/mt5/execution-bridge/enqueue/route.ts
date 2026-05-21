export const runtime = 'nodejs';

import { appendExecutionEvent, stableDedupeKey, upsertExecutionCommand } from '@/lib/execution-bridge-store';
import { queryPostgres } from '@/lib/postgres';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EXECUTION_BRIDGE_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Execution Bridge tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Execution Bridge tool requires local machine access.');
  }
}

function assertExecutionSafety(input: any) {
  const environment = String(input?.environment ?? 'DEMO').toUpperCase();
  const sandboxMode = Boolean(input?.sandboxMode ?? input?.sandbox ?? true);
  const enableLive = String(process.env.CACSMS_ENABLE_LIVE_EXECUTION ?? '').toLowerCase() === 'true';
  if (environment !== 'DEMO' && sandboxMode === false && !enableLive) {
    throw new Error('Live execution is disabled. Enable CACSMS_ENABLE_LIVE_EXECUTION=true or use sandbox mode.');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    const body = (await request.json()) as any;
    assertExecutionSafety(body);

    const dedupeKey =
      typeof body?.dedupeKey === 'string' && body.dedupeKey.trim()
        ? body.dedupeKey.trim()
        : stableDedupeKey({
            terminalId: String(body.terminalId ?? ''),
            type: String(body.type ?? ''),
            symbol: String(body?.payload?.symbol ?? ''),
            side: String(body?.payload?.side ?? ''),
            volumeLots: Number(body?.payload?.volumeLots ?? NaN),
            intentId: String(body?.payload?.intentId ?? ''),
            expiresAt: String(body.expiresAt ?? ''),
          });

    const rowToCommand = (row: any) => ({
      commandId: String(row.command_id),
      terminalId: String(row.terminal_id),
      type: String(row.type),
      payload: row.payload ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      lifecycleState: String(row.lifecycle_state ?? 'QUEUED'),
      environment: String(row.environment ?? 'DEMO'),
      sandboxMode: Boolean(row.sandbox_mode),
      dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
      maxAttempts: Number(row.max_attempts ?? 3),
      attemptCount: Number(row.attempt_count ?? 0),
      ackStatus: row.ack_status ? String(row.ack_status) : null,
      brokerMessage: row.broker_message ? String(row.broker_message) : null,
      ticket: row.ticket ? String(row.ticket) : null,
      executedPrice: row.executed_price == null ? null : Number(row.executed_price),
      executedVolumeLots: row.executed_volume_lots == null ? null : Number(row.executed_volume_lots),
      slippagePoints: row.slippage_points == null ? null : Number(row.slippage_points),
      spreadPoints: row.spread_points == null ? null : Number(row.spread_points),
      lastError: row.last_error ? String(row.last_error) : null,
      lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : new Date().toISOString(),
    });

    let commandResult: { command: any; inserted: boolean };
    try {
      commandResult = await upsertExecutionCommand({
        commandId: String(body.commandId ?? ''),
        terminalId: String(body.terminalId ?? ''),
        type: String(body.type ?? ''),
        payload: (body.payload ?? {}) as Record<string, unknown>,
        createdAt: String(body.createdAt ?? new Date().toISOString()),
        expiresAt: String(body.expiresAt ?? new Date(Date.now() + 60_000).toISOString()),
        environment: String(body.environment ?? 'DEMO') as any,
        sandboxMode: Boolean(body.sandboxMode ?? body.sandbox ?? true),
        dedupeKey,
        maxAttempts: Number(body.maxAttempts ?? 3),
      });
    } catch (error: any) {
      if (String(error?.code ?? '') === '23505') {
        const existing = await queryPostgres(
          `SELECT * FROM execution_commands WHERE dedupe_key = $1 ORDER BY created_at DESC LIMIT 1`,
          [dedupeKey],
        );
        const row = existing.rows[0] as any;
        if (row) {
          return Response.json(
            { ok: true, inserted: false, deduped: true, command: rowToCommand(row) },
            { headers: { 'Cache-Control': 'no-store' } },
          );
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
      );
      return Response.json({ ok: false, error: message || `Bridge enqueue failed with HTTP ${forward.status}`, command, inserted }, { status: 502 });
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
    );
    await appendExecutionEvent({
      commandId: command.commandId,
      terminalId: command.terminalId,
      lifecycleState: 'ROUTING',
      eventType: 'ROUTED',
      severity: 'INFO',
      message: 'Command routed to MT5 bridge queue.',
      payload: { bridgeUrl: bridgeUrl(), inserted },
    }).catch(() => null);

    const bridgePayload = await forward.json().catch(() => ({}));
    return Response.json({ ok: true, command, inserted, bridge: bridgePayload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to enqueue command.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
