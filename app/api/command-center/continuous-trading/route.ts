import {
  getContinuousTradingSessionStatus,
  startContinuousTradingSession,
  stopContinuousTradingSession,
} from '@/lib/continuous-trading-session';
import { requirePlatformAuth } from '@/lib/platform-auth/request-auth';

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
    const auth = await requirePlatformAuth(request, 'view_command_center');
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? '').trim().toLowerCase();
    const operator = auth.user.email || auth.user.displayName;

    if (action === 'start') {
      const session = await startContinuousTradingSession({ operator, userId: auth.user.id });
      return Response.json({ ok: true, session, message: 'Continuous trading started.' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'stop') {
      const session = await stopContinuousTradingSession({
        operator,
        userId: auth.user.id,
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
