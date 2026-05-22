import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService, ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';

export const dynamic = 'force-dynamic';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_ECONOMIC_CALENDAR_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Economic Calendar tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Economic Calendar requires local machine access.');
  }
}

export async function GET(request: Request) {
  try {
    assertLocalOnly(request);
    ensureEconomicCalendarWorkerStarted();
    const service = new EconomicCalendarIntelligenceService();
    const dashboard = await service.getDashboard();
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
