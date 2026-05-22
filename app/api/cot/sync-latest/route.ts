import { NextResponse } from 'next/server';
import { CftcCotFuturesOnlyCollectorService, CotWeeklySchedulerService } from '@/services/cot-sync-service/src/cftc-cot-futures-only-collector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_COT_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('COT tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('COT actions require local machine access.');
  }
}

export async function POST(request: Request) {
  try {
    assertLocalOnly(request);
    new CotWeeklySchedulerService().ensureStarted();
    const result = await new CftcCotFuturesOnlyCollectorService().syncLatest();
    return NextResponse.json(result, { status: result.ok ? 202 : 207, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'cot_sync_failed' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

