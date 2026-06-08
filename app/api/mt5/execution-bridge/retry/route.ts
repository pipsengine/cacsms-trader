export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { upsertExecutionCommand } from '@/lib/execution-bridge-store';
import {
  assertExecutionRiskGate,
  ExecutionRiskBlockedError,
  isExecutionRiskGatedCommandType,
} from '@/lib/execution-risk-gate';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';
import { queryPostgres } from '@/lib/postgres';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const body = (await request.json()) as any;
    const commandId = String(body.commandId ?? '').trim();
    if (!commandId) throw new Error('commandId is required.');

    const existing = await queryPostgres(`SELECT * FROM execution_commands WHERE command_id = $1`, [commandId]);
    const row = existing.rows[0] as any;
    if (!row) return Response.json({ ok: false, error: 'Command not found.' }, { status: 404 });

    const newCommandId = `retry-${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const enrichedPayload = { ...payload, retryOfCommandId: commandId };
    const commandType = String(row.type ?? '');
    const sandboxMode = Boolean(row.sandbox_mode);
    const environment = String(row.environment ?? 'DEMO');

    if (isExecutionRiskGatedCommandType(commandType)) {
      const volume = Number(payload.volume ?? payload.volumeLots ?? NaN);
      await assertExecutionRiskGate({
        terminalId: String(row.terminal_id),
        commandId: newCommandId,
        intentId: String(payload.intentId ?? '').trim() || undefined,
        requestedLots: Number.isFinite(volume) ? volume : 0,
        stopLoss: Number(payload.sl ?? payload.stopLoss ?? 0),
        takeProfit: Number(payload.tp ?? payload.takeProfit ?? 0),
        sandboxMode,
        environment,
      });
    }

    const { command } = await upsertExecutionCommand({
      commandId: newCommandId,
      terminalId: String(row.terminal_id),
      type: String(row.type),
      payload: enrichedPayload,
      createdAt: now.toISOString(),
      expiresAt,
      environment: String(row.environment ?? 'DEMO') as any,
      sandboxMode: Boolean(row.sandbox_mode),
      maxAttempts: Number(row.max_attempts ?? 3),
    });

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
        `UPDATE execution_commands SET last_error = $2, last_updated_at = now() WHERE command_id = $1`,
        [command.commandId, message || `Bridge enqueue failed with HTTP ${forward.status}`],
      );
      return Response.json({ ok: false, error: message || `Bridge enqueue failed with HTTP ${forward.status}`, command }, { status: 502 });
    }

    const bridgePayload = await forward.json().catch(() => ({}));
    return Response.json({ ok: true, command, bridge: bridgePayload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ExecutionRiskBlockedError) {
      return Response.json(
        {
          ok: false,
          error: error.message,
          risk: {
            allowed: false,
            code: error.decision.code,
            message: error.decision.message,
            remainingDailyLossAmount: error.decision.remainingDailyLossAmount,
            accountNumber: error.accountNumber,
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to retry command.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
