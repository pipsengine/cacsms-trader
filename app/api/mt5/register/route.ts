import { recordRegistrationAttempt, upsertTerminalRegistration } from '@/lib/mt5-registration-store';

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
  const registration = await upsertTerminalRegistration(payload);

  let bridgeEnrollment = {
    ok: false,
    status: 0,
    error: 'Bridge enrollment was not attempted.',
  } as { ok: boolean; status: number; error?: string };

  try {
    const response = await fetch(`${bridgeUrl()}/terminals/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bridgeSecretHeader(),
      },
      body: JSON.stringify(payload),
    });

    bridgeEnrollment = {
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : await response.text(),
    };

    await recordRegistrationAttempt(
      registration.terminalId,
      response.ok ? 'bridge_enrolled' : 'bridge_failed',
      response.ok ? 'Registration forwarded to MT5 bridge.' : bridgeEnrollment.error ?? 'Bridge enrollment failed.',
      response.ok ? '' : `HTTP_${response.status}`,
    );
  } catch (error) {
    bridgeEnrollment = {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Bridge unavailable.',
    };

    await recordRegistrationAttempt(
      registration.terminalId,
      'bridge_unavailable',
      bridgeEnrollment.error ?? 'Bridge unavailable.',
      'BRIDGE_UNAVAILABLE',
    );
  }

  return Response.json(
    {
      ok: true,
      registration,
      bridgeEnrollment,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
