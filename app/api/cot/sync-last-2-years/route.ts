import { NextResponse } from 'next/server';
import { assertCotSyncAccess } from '@/lib/cot-sync-access';
import { CftcCotFuturesOnlyCollectorService, CotWeeklySchedulerService } from '@/services/cot-sync-service/src/cftc-cot-futures-only-collector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertCotSyncAccess(request);
    new CotWeeklySchedulerService().ensureStarted();
    const result = await new CftcCotFuturesOnlyCollectorService().syncLast2Years();
    return NextResponse.json(result, { status: result.ok ? 202 : 207, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cot_sync_failed';
    const status = message.includes('local machine access') || message.includes('disabled outside development') ? 403 : 502;
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

