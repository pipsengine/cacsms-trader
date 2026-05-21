export const runtime = 'nodejs';

import { recordAck } from '@/lib/execution-bridge-store';
import { appendEaCommEvent } from '@/lib/ea-communication-store';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function POST(request: Request): Promise<Response> {
  const payload = await request.text();
  const parsed = safeJson(payload);
  const receivedAt = new Date().toISOString();
  if (parsed && typeof parsed === 'object') {
    try {
      const ack = parsed as any;
      await recordAck({
        commandId: String(ack.commandId ?? ''),
        terminalId: String(ack.terminalId ?? ''),
        status: String(ack.status ?? ''),
        ticket: ack.ticket != null ? String(ack.ticket) : undefined,
        brokerMessage: ack.brokerMessage != null ? String(ack.brokerMessage) : undefined,
        executedPrice: ack.executedPrice != null ? Number(ack.executedPrice) : null,
        executedVolumeLots: ack.executedVolumeLots != null ? Number(ack.executedVolumeLots) : null,
        slippagePoints: ack.slippagePoints != null ? Number(ack.slippagePoints) : null,
        spreadPoints: ack.spreadPoints != null ? Number(ack.spreadPoints) : null,
        latencyMs: ack.latencyMs != null ? Number(ack.latencyMs) : null,
        receivedAt: ack.receivedAt != null ? String(ack.receivedAt) : new Date().toISOString(),
      });
    } catch {
      // ignore persistence errors
    }

    const ack = parsed as any;
    await appendEaCommEvent({
      terminalId: String(ack.terminalId ?? '') || null,
      direction: 'INBOUND',
      channel: 'COMMAND',
      eventType: 'ACK_RECEIVED',
      severity: String(ack.status ?? '').toLowerCase() === 'filled' ? 'SUCCESS' : String(ack.status ?? '').toLowerCase() === 'failed' ? 'ERROR' : 'INFO',
      message: `Ack ${String(ack.status ?? 'unknown')} received.`,
      payload: {
        receivedAt,
        commandId: String(ack.commandId ?? ''),
        status: String(ack.status ?? ''),
        ticket: ack.ticket ?? null,
        latencyMs: ack.latencyMs ?? null,
        brokerMessage: ack.brokerMessage ?? null,
        slippagePoints: ack.slippagePoints ?? null,
        spreadPoints: ack.spreadPoints ?? null,
      },
    }).catch(() => null);
  } else {
    await appendEaCommEvent({
      direction: 'INBOUND',
      channel: 'ERROR',
      eventType: 'JSON_INVALID',
      severity: 'ERROR',
      message: 'Ack payload is not valid JSON.',
      payload: { receivedAt, body: payload.slice(0, 4000) },
    }).catch(() => null);
  }
  const response = await fetch(`${bridgeUrl()}/commands/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
      ...bridgeSecretHeader(),
    },
    body: payload,
  });

  const body = await response.text();

  await appendEaCommEvent({
    terminalId: parsed && typeof parsed === 'object' ? String((parsed as any)?.terminalId ?? '') || null : null,
    direction: 'OUTBOUND',
    channel: 'BRIDGE',
    eventType: response.ok ? 'BRIDGE_ACK_FORWARD_OK' : 'BRIDGE_ACK_FORWARD_FAILED',
    severity: response.ok ? 'SUCCESS' : 'ERROR',
    message: response.ok ? 'Ack forwarded to MT5 bridge.' : 'Failed to forward ack to MT5 bridge.',
    payload: { status: response.status },
  }).catch(() => null);

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
