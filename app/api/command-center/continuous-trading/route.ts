import {
  getContinuousTradingSessionStatus,
  startContinuousTradingSession,
  stopContinuousTradingSession,
} from '@/lib/continuous-trading-session';

export async function GET(): Promise<Response> {
  try {
    const session = await getContinuousTradingSessionStatus();
    return Response.json({ ok: true, session }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load continuous trading session.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? '').trim().toLowerCase();
    const operator = typeof body.operator === 'string' ? body.operator : 'command_center';

    if (action === 'start') {
      const session = await startContinuousTradingSession({ operator });
      return Response.json({ ok: true, session, message: 'Continuous trading started.' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'stop') {
      const session = await stopContinuousTradingSession({
        operator,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      return Response.json({ ok: true, session, message: 'Continuous trading stopped.' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return Response.json({ ok: false, error: 'action must be "start" or "stop".' }, { status: 400 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update continuous trading session.' },
      { status: 500 },
    );
  }
}
