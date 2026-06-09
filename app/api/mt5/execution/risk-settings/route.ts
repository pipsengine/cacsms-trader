export const runtime = 'nodejs';

import {
  getExecutionRiskSettings,
  updateExecutionRiskSettings,
} from '@/lib/execution-risk-settings';
import { assertExecutionBridgeToolAccess } from '@/lib/mt5-dev-tool-access';

export async function GET(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const settings = await getExecutionRiskSettings();
    return Response.json({ ok: true, settings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to read execution risk settings.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertExecutionBridgeToolAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      dailyTradeLimitEnabled?: boolean;
      maxTradesPerDay?: number;
    };

    const settings = await updateExecutionRiskSettings({
      dailyTradeLimitEnabled: typeof body.dailyTradeLimitEnabled === 'boolean'
        ? body.dailyTradeLimitEnabled
        : undefined,
      maxTradesPerDay: body.maxTradesPerDay == null ? undefined : Number(body.maxTradesPerDay),
    });

    return Response.json({ ok: true, settings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update execution risk settings.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
