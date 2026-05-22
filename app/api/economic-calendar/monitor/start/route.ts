import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';

export async function POST() {
  const result = await new EconomicCalendarIntelligenceService().recordAction('monitor/start');
  return NextResponse.json(result, { status: result.ok ? 202 : 503 });
}
