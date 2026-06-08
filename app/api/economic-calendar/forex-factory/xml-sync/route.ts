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

export async function POST(request: Request): Promise<Response> {
  try {
    assertEconomicCalendarAccess(request);
    assertRateLimit('economic-calendar:ff:xml-sync', 30_000);
    const result = await new EconomicCalendarIntelligenceService().forexFactoryXmlSync('manual_xml_sync');
    return Response.json({ ok: true, ...result }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'XML sync failed.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

