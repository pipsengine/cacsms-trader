import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';

export async function GET() {
  const service = new EconomicCalendarIntelligenceService();
  const dashboard = await service.getDashboard();
  return NextResponse.json(dashboard);
}
