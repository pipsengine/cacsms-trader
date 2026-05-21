export const runtime = 'nodejs';

import { stableDedupeKey, upsertExecutionCommand } from '@/lib/execution-bridge-store';
import { appendEaCommEvent } from '@/lib/ea-communication-store';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const parsed = safeJson(body);
  if (parsed) {
    try {
      const payload = parsed as any;
      const terminalId = String(payload.terminalId ?? '').trim() || null;
      const dedupeKey =
        typeof payload?.dedupeKey === 'string' && payload.dedupeKey.trim()
          ? payload.dedupeKey.trim()
          : stableDedupeKey({
              terminalId: String(payload.terminalId ?? ''),
              type: String(payload.type ?? ''),
              symbol: String(payload?.payload?.symbol ?? ''),
              side: String(payload?.payload?.side ?? ''),
              volumeLots: Number(payload?.payload?.volumeLots ?? NaN),
              intentId: String(payload?.payload?.intentId ?? ''),
              expiresAt: String(payload.expiresAt ?? ''),
            });

      await upsertExecutionCommand({
        commandId: String(payload.commandId ?? ''),
        terminalId: String(payload.terminalId ?? ''),
        type: String(payload.type ?? ''),
        payload: (payload.payload ?? {}) as Record<string, unknown>,
        createdAt: String(payload.createdAt ?? new Date().toISOString()),
        expiresAt: String(payload.expiresAt ?? new Date(Date.now() + 60_000).toISOString()),
        environment: String(payload.environment ?? 'DEMO') as any,
        sandboxMode: Boolean(payload.sandboxMode ?? payload.sandbox ?? true),
        dedupeKey,
        maxAttempts: Number(payload.maxAttempts ?? 3),
      });

      await appendEaCommEvent({
        terminalId,
        direction: 'OUTBOUND',
        channel: 'COMMAND',
        eventType: 'COMMAND_ENQUEUED',
        severity: 'INFO',
        message: 'Execution command enqueued.',
        payload: { commandId: String(payload.commandId ?? ''), type: String(payload.type ?? ''), dedupeKey, environment: String(payload.environment ?? 'DEMO') },
      }).catch(() => null);
    } catch {
      // ignore persistence errors; enqueue still forwards to bridge
    }
  } else {
    await appendEaCommEvent({
      direction: 'INBOUND',
      channel: 'ERROR',
      eventType: 'JSON_INVALID',
      severity: 'ERROR',
      message: 'Enqueue payload is not valid JSON.',
      payload: { body: body.slice(0, 4000) },
    }).catch(() => null);
  }

  const response = await fetch(`${bridgeUrl()}/commands/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...bridgeSecretHeader(),
    },
    body,
  });
  const responseBody = await response.text();

  await appendEaCommEvent({
    terminalId: parsed && typeof parsed === 'object' ? String((parsed as any)?.terminalId ?? '') || null : null,
    direction: 'OUTBOUND',
    channel: 'BRIDGE',
    eventType: response.ok ? 'BRIDGE_ENQUEUE_OK' : 'BRIDGE_ENQUEUE_FAILED',
    severity: response.ok ? 'SUCCESS' : 'ERROR',
    message: response.ok ? 'Command forwarded to bridge.' : 'Failed to forward command to bridge.',
    payload: { status: response.status },
  }).catch(() => null);

  return new Response(responseBody, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
