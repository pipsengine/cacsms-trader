export const runtime = 'nodejs';

import { recordDispatch, upsertExecutionCommand } from '@/lib/execution-bridge-store';
import { appendEaCommEvent } from '@/lib/ea-communication-store';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const terminalId = url.searchParams.get('terminalId') ?? '';
  const startedAt = Date.now();

  if (!terminalId) {
    await appendEaCommEvent({
      direction: 'INBOUND',
      channel: 'COMMAND',
      eventType: 'COMMAND_POLL_REJECTED',
      severity: 'ERROR',
      message: 'terminalId is required for command poll.',
      payload: { path: url.pathname, receivedAt: new Date().toISOString() },
    }).catch(() => null);
    return new Response(JSON.stringify({ ok: false, error: 'terminalId is required.' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  await appendEaCommEvent({
    terminalId,
    direction: 'INBOUND',
    channel: 'COMMAND',
    eventType: 'COMMAND_POLL_RECEIVED',
    severity: 'INFO',
    message: `Command poll received from ${terminalId}.`,
    payload: { receivedAt: new Date().toISOString() },
  }).catch(() => null);

  const response = await fetch(`${bridgeUrl()}/commands/next?terminalId=${encodeURIComponent(terminalId)}`, {
    method: 'GET',
    headers: {
      ...bridgeSecretHeader(),
    },
    cache: 'no-store',
  });

  const body = await response.text();
  const durationMs = Math.max(0, Date.now() - startedAt);

  await appendEaCommEvent({
    terminalId,
    direction: 'OUTBOUND',
    channel: 'BRIDGE',
    eventType: response.ok ? 'BRIDGE_COMMAND_POLL_OK' : 'BRIDGE_COMMAND_POLL_FAILED',
    severity: response.ok ? 'SUCCESS' : 'ERROR',
    message: response.ok ? 'Bridge command poll succeeded.' : 'Bridge command poll failed.',
    payload: { bridgeUrl: bridgeUrl(), status: response.status, durationMs },
  }).catch(() => null);

  const payload = safeJson(body);
  const command = payload && typeof payload === 'object' ? (payload as any).command : null;
  if (response.ok && command && typeof command === 'object') {
    const now = new Date().toISOString();
    try {
      await upsertExecutionCommand({
        commandId: String(command.commandId ?? ''),
        terminalId: String(command.terminalId ?? terminalId),
        type: String(command.type ?? ''),
        payload: (command.payload ?? {}) as Record<string, unknown>,
        createdAt: String(command.createdAt ?? now),
        expiresAt: String(command.expiresAt ?? new Date(Date.now() + 60_000).toISOString()),
        environment: 'DEMO',
        sandboxMode: true,
      });
      await recordDispatch({
        terminalId: String(command.terminalId ?? terminalId),
        command,
        dispatchedAt: now,
      });
    } catch {
      // ignore persistence errors
    }

    await appendEaCommEvent({
      terminalId: String(command.terminalId ?? terminalId),
      direction: 'OUTBOUND',
      channel: 'COMMAND',
      eventType: 'COMMAND_DELIVERED',
      severity: 'INFO',
      message: `Command delivered to ${terminalId}.`,
      payload: {
        commandId: String(command.commandId ?? ''),
        type: String(command.type ?? ''),
        expiresAt: String(command.expiresAt ?? ''),
        durationMs,
      },
    }).catch(() => null);
  } else if (response.ok) {
    await appendEaCommEvent({
      terminalId,
      direction: 'OUTBOUND',
      channel: 'COMMAND',
      eventType: 'COMMAND_EMPTY',
      severity: 'DEBUG',
      message: `No command available for ${terminalId}.`,
      payload: { durationMs },
    }).catch(() => null);
  } else {
    await appendEaCommEvent({
      terminalId,
      direction: 'OUTBOUND',
      channel: 'COMMAND',
      eventType: payload ? 'COMMAND_POLL_ERROR' : 'JSON_INVALID',
      severity: 'ERROR',
      message: payload ? `Command poll failed with HTTP ${response.status}.` : 'Bridge response JSON invalid.',
      payload: { status: response.status, durationMs, body: body.slice(0, 4000) },
    }).catch(() => null);
  }
  return new Response(body, {
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
