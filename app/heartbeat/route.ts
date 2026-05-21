import { recordTerminalHeartbeat } from '@/lib/mt5-heartbeat-store';

export const runtime = 'nodejs';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

export async function POST(request: Request): Promise<Response> {
  const payload = await request.json();
  const terminal = await recordTerminalHeartbeat(payload);

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

