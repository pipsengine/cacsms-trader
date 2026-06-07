export const runtime = 'nodejs';

import {
  assertDevToolEnabled,
  assertLocalToolAccess,
} from '@/lib/local-access';
import {
  generateMt5BridgeSecret,
  getMt5BridgeSecretStatus,
  persistMt5BridgeSharedSecret,
} from '@/lib/mt5-bridge-secret';

function assertBridgeSecretToolAccess(request: Request): void {
  assertDevToolEnabled('CACSMS_ENABLE_MT5_BRIDGE_SECRET_TOOL', 'MT5 bridge secret tool');
  assertLocalToolAccess(request, 'MT5 bridge secret management requires local machine access.');
}

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertBridgeSecretToolAccess(request);
    const status = await getMt5BridgeSecretStatus();
    return Response.json(
      {
        ok: true,
        bridgeUrl: bridgeUrl(),
        secret: status.secret,
        masked: status.masked,
        source: status.source,
        configured: status.configured,
        updatedAt: status.updatedAt,
        eaInputName: 'BridgeSecret',
        envVarName: 'MT5_BRIDGE_SHARED_SECRET',
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load bridge secret.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertBridgeSecretToolAccess(request);
    const body = await request.json();
    const action = String(body?.action ?? 'generate').toLowerCase();

    if (action === 'generate') {
      const secret = generateMt5BridgeSecret();
      return Response.json(
        {
          ok: true,
          action: 'generate',
          secret,
          masked: secret.slice(0, 4) + '…' + secret.slice(-4),
          message: 'Generated a new bridge secret. Click Apply to activate it for the portal and MT5 bridge.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (action === 'apply') {
      const secret = String(body?.secret ?? '').trim();
      if (!secret) {
        throw new Error('secret is required to apply a bridge secret.');
      }
      await persistMt5BridgeSharedSecret(secret);
      const status = await getMt5BridgeSecretStatus();
      return Response.json(
        {
          ok: true,
          action: 'apply',
          secret: status.secret,
          masked: status.masked,
          source: status.source,
          configured: status.configured,
          updatedAt: status.updatedAt,
          message: 'Bridge secret applied. Paste the same value into the EA BridgeSecret input in MT5.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to update bridge secret.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
