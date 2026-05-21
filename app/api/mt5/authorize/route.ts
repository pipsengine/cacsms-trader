export const runtime = 'nodejs';

import { appendEaCommEvent } from '@/lib/ea-communication-store';

export async function POST(request: Request): Promise<Response> {
  const payload = await request.json();
  if (!payload.terminalId || !payload.accountNumber) {
    await appendEaCommEvent({
      terminalId: payload?.terminalId ? String(payload.terminalId) : null,
      direction: 'INBOUND',
      channel: 'AUTH',
      eventType: 'AUTH_REQUEST_REJECTED',
      severity: 'ERROR',
      message: 'terminalId and accountNumber are required for EA authorization.',
      payload: { receivedAt: new Date().toISOString() },
    }).catch(() => null);
    return Response.json({
      ok: false,
      status: 'failed',
      error: 'terminalId and accountNumber are required for EA authorization',
    }, { status: 422 });
  }

  await appendEaCommEvent({
    terminalId: String(payload.terminalId),
    direction: 'INBOUND',
    channel: 'AUTH',
    eventType: 'AUTH_REQUEST_RECEIVED',
    severity: 'INFO',
    message: 'EA authorization request received.',
    payload: { receivedAt: new Date().toISOString(), accountNumber: String(payload.accountNumber) },
  }).catch(() => null);

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
  const tokenSeed = `${payload.terminalId}:${payload.accountNumber}:${issuedAt.getTime()}`;

  const response = {
    ok: true,
    status: 'authorized',
    terminalId: payload.terminalId,
    tokenId: `auth_${hashToken(tokenSeed).slice(0, 16)}`,
    authenticationKey: `ea_live_${hashToken(`${tokenSeed}:key`)}${hashToken(`${tokenSeed}:session`).slice(0, 12)}`,
    policy: {
      scope: ['heartbeat:write', 'tick:write', 'command:poll', 'ack:write'],
      encryption: 'tls-required',
      sessionSigning: 'hmac-sha256',
      fingerprintRequired: true,
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await appendEaCommEvent({
    terminalId: String(payload.terminalId),
    direction: 'OUTBOUND',
    channel: 'AUTH',
    eventType: 'AUTH_ISSUED',
    severity: 'SUCCESS',
    message: 'EA authentication credentials issued.',
    payload: { tokenId: response.tokenId, issuedAt: response.issuedAt, expiresAt: response.expiresAt, policy: response.policy },
  }).catch(() => null);

  return Response.json(response);
}

function hashToken(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
}
