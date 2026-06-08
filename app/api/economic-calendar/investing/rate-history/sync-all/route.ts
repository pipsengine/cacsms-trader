import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { ensureRateDecisionHistoryTables, InvestingHistoricalRateDecisionCollectorService, InvestingRateDecisionWeeklySchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';



function assertRateLimit(key: string, windowMs: number) {
  const globalAny = globalThis as unknown as { __cacsmsRateLimits?: Map<string, number> };
  if (!globalAny.__cacsmsRateLimits) globalAny.__cacsmsRateLimits = new Map();
  const now = Date.now();
  const last = globalAny.__cacsmsRateLimits.get(key) ?? 0;
  if (now - last < windowMs) throw new Error('rate_limited');
  globalAny.__cacsmsRateLimits.set(key, now);
}

export async function POST(request: Request): Promise<Response> {
  try {
    new InvestingRateDecisionWeeklySchedulerService().ensureStarted();
    await ensureRateDecisionHistoryTables();
    assertEconomicCalendarAccess(request);
    assertRateLimit('economic-calendar:investing:rate-history:sync-all', 60_000);
    const result = await new InvestingHistoricalRateDecisionCollectorService().syncAllLast3Years();
    return Response.json({ ...result }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Rate history sync failed.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
