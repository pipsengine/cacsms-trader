import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dashboard = await new EconomicCalendarIntelligenceService().getDashboard();
  return NextResponse.json({ ok: dashboard.ok, sources: dashboard.sources, providerStatuses: dashboard.providerStatuses });
}
