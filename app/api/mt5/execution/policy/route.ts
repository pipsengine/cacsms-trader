export const runtime = 'nodejs';

import { getCommandTimeoutPolicy, getExecutionPolicyStatus } from '@/lib/execution-policy';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const status = await getExecutionPolicyStatus();
    return Response.json(
      {
        ok: true,
        policy: status,
        commandPolicies: {
          place_order: getCommandTimeoutPolicy('place_order'),
          modify_order: getCommandTimeoutPolicy('modify_order'),
          close_order: getCommandTimeoutPolicy('close_order'),
          partial_close: getCommandTimeoutPolicy('partial_close'),
          move_to_breakeven: getCommandTimeoutPolicy('move_to_breakeven'),
          set_trailing_stop: getCommandTimeoutPolicy('set_trailing_stop'),
          emergency_close_all: getCommandTimeoutPolicy('emergency_close_all'),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to read execution policy.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
