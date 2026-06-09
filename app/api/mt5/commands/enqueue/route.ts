export const runtime = 'nodejs';

import { dispatchExecutionCommand, ExecutionPolicyBlockedError, ExecutionRiskBlockedError } from '@/lib/execution-dispatch';
import { appendEaCommEvent } from '@/lib/ea-communication-store';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const parsed = safeJson(body);
  if (!parsed || typeof parsed !== 'object') {
    await appendEaCommEvent({
      direction: 'INBOUND',
      channel: 'ERROR',
      eventType: 'JSON_INVALID',
      severity: 'ERROR',
      message: 'Enqueue payload is not valid JSON.',
      payload: { body: body.slice(0, 4000) },
    }).catch(() => null);
    return Response.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const payload = parsed as Record<string, unknown>;
  const terminalId = String(payload.terminalId ?? '').trim();
  const commandType = String(payload.type ?? '');
  const sandboxMode = Boolean(payload.sandboxMode ?? payload.sandbox ?? true);
  const environment = String(payload.environment ?? 'DEMO');
  const innerPayload = (payload.payload ?? {}) as Record<string, unknown>;

  try {
    const result = await dispatchExecutionCommand({
      commandId: String(payload.commandId ?? '').trim() || undefined,
      terminalId,
      type: commandType,
      payload: innerPayload,
      createdAt: String(payload.createdAt ?? new Date().toISOString()),
      expiresAt: String(payload.expiresAt ?? ''),
      environment: environment as any,
      sandboxMode,
      dedupeKey: typeof payload.dedupeKey === 'string' ? payload.dedupeKey : undefined,
      maxAttempts: Number(payload.maxAttempts ?? 0) || undefined,
      intentId: String(innerPayload.intentId ?? '').trim() || undefined,
      source: 'COMMANDS_ENQUEUE_API',
    });

    await appendEaCommEvent({
      terminalId: terminalId || null,
      direction: 'OUTBOUND',
      channel: 'COMMAND',
      eventType: 'COMMAND_ENQUEUED',
      severity: 'INFO',
      message: 'Execution command enqueued.',
      payload: {
        commandId: result.command.commandId,
        type: result.command.type,
        dedupeKey: result.command.dedupeKey,
        environment,
      },
    }).catch(() => null);

    return Response.json(
      { ok: true, command: result.command, inserted: result.inserted, deduped: result.deduped ?? false, bridge: result.bridge },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ExecutionRiskBlockedError) {
      await appendEaCommEvent({
        terminalId: terminalId || null,
        direction: 'OUTBOUND',
        channel: 'ERROR',
        eventType: 'RISK_BLOCKED',
        severity: 'WARNING',
        message: error.message,
        payload: {
          code: error.decision.code,
          remainingDailyLossAmount: error.decision.remainingDailyLossAmount,
        },
      }).catch(() => null);
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

    await appendEaCommEvent({
      terminalId: terminalId || null,
      direction: 'OUTBOUND',
      channel: 'BRIDGE',
      eventType: 'BRIDGE_ENQUEUE_FAILED',
      severity: 'ERROR',
      message: error instanceof Error ? error.message : 'Failed to enqueue command.',
      payload: {},
    }).catch(() => null);

    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to enqueue command.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
