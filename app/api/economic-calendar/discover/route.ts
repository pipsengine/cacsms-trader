import { NextResponse } from 'next/server';
import { EconomicCalendarIntelligenceService } from '@/services/economic-data-service/src/economic-calendar-intelligence';

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
    throw new Error('Economic Calendar actions require local machine access.');
  }
}

export async function POST(request: Request) {
  try {
    assertLocalOnly(request);
    const result = await new EconomicCalendarIntelligenceService().recordAction('discover');
    return NextResponse.json(result, { status: result.ok ? 202 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'discover_failed' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
