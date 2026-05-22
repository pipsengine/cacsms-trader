export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { ensureRateDecisionHistoryTables, InvestingHistoricalRateDecisionCollectorService, InvestingRateDecisionWeeklySchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

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
    throw new Error('Rate history sync requires local machine access.');
  }
}

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
    assertLocalOnly(request);
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
