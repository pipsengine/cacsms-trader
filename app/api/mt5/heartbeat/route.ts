import { recordTerminalHeartbeat } from '@/lib/mt5-heartbeat-store';
import { appendEaCommEvent } from '@/lib/ea-communication-store';
import { syncPlatformMt5FromHeartbeat } from '@/lib/platform-auth/mt5-platform-sync';

export const runtime = 'nodejs';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function POST(request: Request): Promise<Response> {
  const receivedAt = new Date().toISOString();
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    await appendEaCommEvent({
      direction: 'INBOUND',
      channel: 'ERROR',
      eventType: 'JSON_INVALID',
      severity: 'ERROR',
      message: 'Heartbeat payload is not valid JSON.',
      payload: { receivedAt },
    }).catch(() => null);
    return Response.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const terminalId = String(payload?.terminalId ?? '').trim() || null;
  const accountNumber = String(payload?.accountNumber ?? '').trim() || null;
  const version = String(payload?.version ?? 'unknown').trim();
  const lastTickTime = String(payload?.lastTickTime ?? payload?.mt5ServerTime ?? '').trim();
  const lastTickMs = Date.parse(lastTickTime);
  const tickLagMs = Number.isFinite(lastTickMs) ? Math.max(0, Date.now() - lastTickMs) : null;
  const latencyMs = Number.isFinite(Number(payload?.latencyMs)) ? Math.max(0, Math.round(Number(payload.latencyMs))) : null;

  let terminal: any = null;
  try {
    terminal = await recordTerminalHeartbeat(payload);
  } catch (error) {
    await appendEaCommEvent({
      terminalId,
      direction: 'INBOUND',
      channel: 'HEARTBEAT',
      eventType: 'HEARTBEAT_REJECTED',
      severity: 'ERROR',
      message: error instanceof Error ? error.message : 'Heartbeat rejected.',
      payload: { receivedAt, terminalId, accountNumber, version, lastTickTime },
    }).catch(() => null);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Heartbeat rejected.' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  await appendEaCommEvent({
    terminalId,
    direction: 'INBOUND',
    channel: 'HEARTBEAT',
    eventType: 'HEARTBEAT_RECEIVED',
    severity: tickLagMs != null && tickLagMs > 10_000 ? 'WARNING' : 'INFO',
    message: `Heartbeat received${terminalId ? ` from ${terminalId}` : ''}.`,
    payload: { receivedAt, accountNumber, version, latencyMs, tickLagMs, lastTickTime },
  }).catch(() => null);

  void syncPlatformMt5FromHeartbeat({
    terminalId,
    accountNumber,
    symbol: String(payload?.symbol ?? 'XAUUSD'),
  }).catch(() => null);

  let bridgeForwarded = false;
  let bridgeError = '';

  try {
    const response = await fetch(`${bridgeUrl()}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bridgeSecretHeader(),
      },
      body: JSON.stringify(payload),
    });
    bridgeForwarded = response.ok;
    bridgeError = response.ok ? '' : await response.text();
  } catch (error) {
    bridgeError = error instanceof Error ? error.message : 'MT5 bridge unavailable.';
  }

  await appendEaCommEvent({
    terminalId,
    direction: 'OUTBOUND',
    channel: 'BRIDGE',
    eventType: bridgeForwarded ? 'BRIDGE_FORWARD_OK' : 'BRIDGE_FORWARD_FAILED',
    severity: bridgeForwarded ? 'SUCCESS' : 'ERROR',
    message: bridgeForwarded ? 'Heartbeat forwarded to MT5 bridge.' : 'Failed to forward heartbeat to MT5 bridge.',
    payload: { bridgeUrl: bridgeUrl(), bridgeError: bridgeError || null },
  }).catch(() => null);

  return Response.json(
    {
      ok: true,
      terminal,
      bridgeForwarded,
      bridgeError,
      receivedAt: terminal?.receivedAt ?? new Date().toISOString(),
      heartbeatTimeoutMs: Number(process.env.MT5_HEARTBEAT_TIMEOUT_MS ?? 15000),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
