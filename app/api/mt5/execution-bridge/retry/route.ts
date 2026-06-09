export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { dispatchExecutionCommand, ExecutionPolicyBlockedError, ExecutionRiskBlockedError } from '@/lib/execution-dispatch';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';
import { queryPostgres } from '@/lib/postgres';

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const body = (await request.json()) as { commandId?: string };
    const commandId = String(body.commandId ?? '').trim();
    if (!commandId) throw new Error('commandId is required.');

    const existing = await queryPostgres(`SELECT * FROM execution_commands WHERE command_id = $1`, [commandId]);
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    if (!row) return Response.json({ ok: false, error: 'Command not found.' }, { status: 404 });

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const newCommandId = `retry-${crypto.randomUUID()}`;
    const enrichedPayload = { ...payload, retryOfCommandId: commandId, manualRetry: true };

    const result = await dispatchExecutionCommand({
      commandId: newCommandId,
      terminalId: String(row.terminal_id),
      type: String(row.type),
      payload: enrichedPayload,
      environment: String(row.environment ?? 'DEMO') as any,
      sandboxMode: Boolean(row.sandbox_mode),
      maxAttempts: Number(row.max_attempts ?? 3),
      intentId: String(payload.intentId ?? '').trim() || undefined,
      source: 'MANUAL_RETRY',
    });

    return Response.json({ ok: true, command: result.command, bridge: result.bridge }, { headers: { 'Cache-Control': 'no-store' } });
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
    if (error instanceof ExecutionPolicyBlockedError) {
      return Response.json({ ok: false, error: error.message, code: error.code }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to retry command.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
