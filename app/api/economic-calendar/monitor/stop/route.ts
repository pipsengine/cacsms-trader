import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';

import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService, stopEconomicCalendarWorker } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';



export async function POST(request: Request) {
  try {
    assertEconomicCalendarAccess(request);
    stopEconomicCalendarWorker();
    const result = await new EconomicCalendarIntelligenceService().recordAction('monitor/stop');
    return NextResponse.json(result, { status: result.ok ? 202 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'monitor_stop_failed' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
