export const runtime = 'nodejs';

import {
  activateExecutionKillSwitch,
  deactivateExecutionKillSwitch,
  getExecutionKillSwitchStatus,
} from '@/lib/execution-kill-switch';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    return Response.json({ ok: true, ...(await getExecutionKillSwitchStatus()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to read execution kill switch.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      active?: boolean;
      reason?: string;
      operator?: string;
    };
    const active = Boolean(body.active);
    const status = active
      ? await activateExecutionKillSwitch({
          reason: typeof body.reason === 'string' ? body.reason : undefined,
          operator: typeof body.operator === 'string' ? body.operator : undefined,
        })
      : await deactivateExecutionKillSwitch({
          reason: typeof body.reason === 'string' ? body.reason : undefined,
          operator: typeof body.operator === 'string' ? body.operator : undefined,
        });

    return Response.json({ ok: true, ...status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update execution kill switch.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
