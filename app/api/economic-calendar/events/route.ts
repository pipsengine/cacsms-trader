import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';

import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService, ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';



function shouldAutoDiscover(): boolean {
  const globalAny = globalThis as unknown as { __cacsmsEconomicCalendarAutoDiscoverAt?: number };
  const now = Date.now();
  const last = globalAny.__cacsmsEconomicCalendarAutoDiscoverAt ?? 0;
  if (now - last < 5 * 60_000) return false;
  globalAny.__cacsmsEconomicCalendarAutoDiscoverAt = now;
  return true;
}

export async function GET(request: Request) {
  try {
    assertEconomicCalendarAccess(request);
    ensureEconomicCalendarWorkerStarted();
    const service = new EconomicCalendarIntelligenceService();
    let dashboard = await service.getDashboard();
    if (dashboard.ok && dashboard.events.length === 0 && shouldAutoDiscover()) {
      await service.recordAction('discover');
      dashboard = await service.getDashboard();
    }
    return NextResponse.json(dashboard, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        generatedAt: new Date().toISOString(),
        events: [],
        sources: [],
        summary: {
          todaysHighImpactEvents: 0,
          upcomingNext24Hours: 0,
          monitoringNow: 0,
          releasedAwaitingAnalysis: 0,
          activeTradeRestrictions: 0,
          sourceCollectionHealth: 0,
          strongestBullishCurrencyToday: null,
          strongestBearishCurrencyToday: null,
        },
        currencyBias: [],
        conflicts: [],
        sourceLogs: [],
        providerStatuses: [{ provider: 'Economic Calendar', status: 'error', message: error instanceof Error ? error.message : 'forbidden' }],
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
