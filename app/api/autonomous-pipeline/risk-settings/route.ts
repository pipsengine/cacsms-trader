export const runtime = 'nodejs';

import {
  getExecutionRiskSettings,
  updateExecutionRiskSettings,
} from '@/lib/execution-risk-settings';

export async function GET(): Promise<Response> {
  try {
    const settings = await getExecutionRiskSettings();
    return Response.json({ ok: true, settings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to read pipeline risk settings.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      dailyTradeLimitEnabled?: boolean;
      maxTradesPerDay?: number;
      tradesPerSymbolPerDay?: number;
    };

    const settings = await updateExecutionRiskSettings({
      dailyTradeLimitEnabled: typeof body.dailyTradeLimitEnabled === 'boolean'
        ? body.dailyTradeLimitEnabled
        : undefined,
      maxTradesPerDay: body.maxTradesPerDay == null ? undefined : Number(body.maxTradesPerDay),
      tradesPerSymbolPerDay: body.tradesPerSymbolPerDay == null ? undefined : Number(body.tradesPerSymbolPerDay),
    });

    return Response.json({ ok: true, settings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update pipeline risk settings.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
