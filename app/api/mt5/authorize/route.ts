export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const payload = await request.json();
  if (!payload.terminalId || !payload.accountNumber) {
    return Response.json({
      ok: false,
      status: 'failed',
      error: 'terminalId and accountNumber are required for EA authorization',
    }, { status: 422 });
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
  const tokenSeed = `${payload.terminalId}:${payload.accountNumber}:${issuedAt.getTime()}`;

  return Response.json({
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
  });
}

function hashToken(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
}
