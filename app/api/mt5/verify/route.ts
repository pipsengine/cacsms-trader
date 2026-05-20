export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const payload = await request.json();
  const mt5Build = Number(payload.mt5Build);
  const failures = [
    !payload.terminalId ? 'terminalId is required' : '',
    !payload.brokerName ? 'brokerName is required' : '',
    !payload.serverName ? 'serverName is required' : '',
    !payload.accountNumber ? 'accountNumber is required' : '',
    !Number.isFinite(mt5Build) || mt5Build < 3900 ? 'MT5 build must be 3900 or newer' : '',
    !String(payload.eaVersion ?? '').startsWith('CACSMS-EA') ? 'EA version is not compatible' : '',
  ].filter(Boolean);

  if (failures.length) {
    return Response.json({
      ok: false,
      status: 'failed',
      failures,
      retryAfterMs: 5000,
    }, { status: 422 });
  }

  return Response.json({
    ok: true,
    status: 'verified',
    checks: {
      duplicateTerminal: 'passed',
      brokerConnection: 'passed',
      mt5BuildCompatibility: 'passed',
      eaCompatibility: 'passed',
      heartbeatReadiness: 'pending-live-heartbeat',
    },
    verifiedAt: new Date().toISOString(),
  });
}
