import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { EconomicCalendarIntelligenceService } from '@/services/economic-data-service/src/economic-calendar-intelligence';



function assertRateLimit(key: string, windowMs: number) {
  const globalAny = globalThis as unknown as { __cacsmsRateLimits?: Map<string, number> };
  if (!globalAny.__cacsmsRateLimits) globalAny.__cacsmsRateLimits = new Map();
  const now = Date.now();
  const last = globalAny.__cacsmsRateLimits.get(key) ?? 0;
  if (now - last < windowMs) throw new Error('rate_limited');
  globalAny.__cacsmsRateLimits.set(key, now);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertEconomicCalendarAccess(request);
    const { id } = await ctx.params;
    assertRateLimit(`economic-calendar:capture-actual:${id}`, 20_000);
    const result = await new EconomicCalendarIntelligenceService().captureActualFromWebsite(id);
    return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : 'Capture actual failed.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

