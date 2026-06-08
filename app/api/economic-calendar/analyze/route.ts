import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';

import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';



export async function POST(request: Request) {
  try {
    assertEconomicCalendarAccess(request);
    const result = await new EconomicCalendarIntelligenceService().recordAction('analyze');
    return NextResponse.json(result, { status: result.ok ? 202 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'analyze_failed' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
