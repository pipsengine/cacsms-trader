import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { ensureRateDecisionHistoryTables, InvestingRateDecisionWeeklySchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseLimit(value: string | null, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}

export async function GET(request: Request) {
  try {
    new InvestingRateDecisionWeeklySchedulerService().ensureStarted();
    await ensureRateDecisionHistoryTables();
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'), 200, 500);
    const pageId = url.searchParams.get('sourcePageId');

    const clauses: string[] = [];
    const params: any[] = [];
    if (pageId && pageId !== 'All') {
      const n = Number(pageId);
      if (Number.isFinite(n)) {
        params.push(Math.round(n));
        clauses.push(`source_page_id = $${params.length}`);
      }
    }

    params.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          job_type,
          source_page_id,
          status,
          message,
          details,
          fetched_at::text AS fetched_at
        FROM rate_decision_history_logs
        ${where}
        ORDER BY fetched_at DESC, id DESC
        LIMIT $${params.length}
      `,
      params,
    );

    return NextResponse.json(
      { ok: true, generatedAt: new Date().toISOString(), logs: rows.rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = (error as any)?.code;
    if (code === '42P01') {
      return NextResponse.json(
        { ok: false, generatedAt: new Date().toISOString(), logs: [], error: 'Missing rate decision tables. Run database migration 013_rate_decision_history.sql.' },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'rate_history_logs_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
