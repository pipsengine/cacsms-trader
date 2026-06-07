export const runtime = 'nodejs';

import { appendExecutionEvent, stableDedupeKey, upsertExecutionCommand } from '@/lib/execution-bridge-store';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';
import { queryPostgres } from '@/lib/postgres';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
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
    assertExecutionBridgeToolAccess(request);
    const body = (await request.json()) as any;
    const mode = String(body?.mode ?? '').toUpperCase();
    const sandboxMode = Boolean(body?.sandboxMode ?? body?.sandbox ?? (mode ? mode === 'SANDBOX' : true));
    const environment = String(body?.environment ?? body?.payload?.environment ?? 'DEMO').toUpperCase();
    const commandType = String(body?.type ?? '').trim() || 'PLACE_ORDER';

    const resolvedSymbol = String(body?.symbol ?? body?.payload?.symbol ?? '').trim();
    const resolvedSideRaw = String(body?.side ?? body?.payload?.side ?? '').trim();
    const resolvedSide = resolvedSideRaw ? resolvedSideRaw.toUpperCase() : 'BUY';
    const resolvedOrderType = String(body?.orderType ?? body?.payload?.orderType ?? body?.payload?.orderKind ?? 'MARKET').trim().toUpperCase();
    const resolvedVolume = Number(body?.volume ?? body?.payload?.volume ?? body?.payload?.volumeLots ?? NaN);
    const resolvedSl = Number(body?.sl ?? body?.payload?.sl ?? body?.payload?.stopLoss ?? 0);
    const resolvedTp = Number(body?.tp ?? body?.payload?.tp ?? body?.payload?.takeProfit ?? 0);
    const resolvedComment = String(body?.comment ?? body?.payload?.comment ?? 'Cacsms Trader sandbox test');

    const canonicalPayload: Record<string, unknown> = {
      mode: sandboxMode ? 'SANDBOX' : 'LIVE',
      environment,
      symbol: resolvedSymbol,
      side: resolvedSide,
      orderType: resolvedOrderType,
      volume: Number.isFinite(resolvedVolume) ? resolvedVolume : null,
      sl: Number.isFinite(resolvedSl) ? resolvedSl : 0,
      tp: Number.isFinite(resolvedTp) ? resolvedTp : 0,
      comment: resolvedComment,
      orderKind: resolvedOrderType.toLowerCase(),
      volumeLots: Number.isFinite(resolvedVolume) ? resolvedVolume : null,
      stopLoss: Number.isFinite(resolvedSl) ? resolvedSl : 0,
      takeProfit: Number.isFinite(resolvedTp) ? resolvedTp : 0,
      sideLower: resolvedSide.toLowerCase(),
    };

    const normalizedBody = {
      ...body,
      type: commandType,
      sandboxMode,
      environment,
      payload: typeof body?.payload === 'object' && body.payload ? { ...canonicalPayload, ...(body.payload ?? {}) } : canonicalPayload,
    };

    if (String(commandType).trim().toUpperCase() === 'PLACE_ORDER') {
      if (!resolvedSymbol) throw new Error('symbol is required.');
      if (!Number.isFinite(resolvedVolume) || resolvedVolume <= 0) throw new Error('volume must be a positive number.');
      if (resolvedOrderType !== 'MARKET') throw new Error('Only MARKET orderType is supported in the current test pipeline.');
      if (resolvedSide !== 'BUY' && resolvedSide !== 'SELL') throw new Error('side must be BUY or SELL.');
    }

    assertExecutionSafety(normalizedBody);

    const dedupeKey =
      typeof normalizedBody?.dedupeKey === 'string' && normalizedBody.dedupeKey.trim()
        ? normalizedBody.dedupeKey.trim()
        : stableDedupeKey({
            terminalId: String(normalizedBody.terminalId ?? ''),
            type: String(normalizedBody.type ?? ''),
            symbol: resolvedSymbol || String(normalizedBody?.payload?.symbol ?? ''),
            side: resolvedSide || String(normalizedBody?.payload?.side ?? ''),
            volumeLots: Number.isFinite(resolvedVolume) ? resolvedVolume : Number(normalizedBody?.payload?.volumeLots ?? normalizedBody?.payload?.volume ?? NaN),
            intentId: String(normalizedBody?.payload?.intentId ?? ''),
            expiresAt: String(normalizedBody.expiresAt ?? ''),
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
        commandId: String(normalizedBody.commandId ?? ''),
        terminalId: String(normalizedBody.terminalId ?? ''),
        type: String(normalizedBody.type ?? ''),
        payload: (normalizedBody.payload ?? {}) as Record<string, unknown>,
        createdAt: String(normalizedBody.createdAt ?? new Date().toISOString()),
        expiresAt: String(normalizedBody.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString()),
        environment: environment as any,
        sandboxMode,
        dedupeKey,
        maxAttempts: Number(normalizedBody.maxAttempts ?? 3),
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
      try {
        await queryPostgres(
          `
            UPDATE execution_commands
            SET last_error = $2,
                last_updated_at = now()
            WHERE command_id = $1
          `,
          [command.commandId, message || `Bridge enqueue failed with HTTP ${forward.status}`],
        );
      } catch {
      }
      return Response.json({ ok: false, error: message || `Bridge enqueue failed with HTTP ${forward.status}`, command, inserted }, { status: 502 });
    }

    try {
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
    } catch {
    }
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
