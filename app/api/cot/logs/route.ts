import { NextResponse } from 'next/server';
import { CotSourceLogService, CotWeeklySchedulerService } from '@/services/cot-sync-service/src/cftc-cot-futures-only-collector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    new CotWeeklySchedulerService().ensureStarted();
    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Math.round(Number(url.searchParams.get('limit') ?? 200))));
    const logs = await new CotSourceLogService().list(limit);
    return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), logs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === '42P01') {
      return NextResponse.json(
        {
          ok: false,
          generatedAt: new Date().toISOString(),
          logs: [],
          error: 'Missing COT tables. Run database migration 012_cot_institutional_positions.sql.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'cot_logs_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
