import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { ensureRateDecisionHistoryTables, InvestingRateDecisionWeeklySchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ currency: string }> }) {
  try {
    new InvestingRateDecisionWeeklySchedulerService().ensureStarted();
    await ensureRateDecisionHistoryTables();
    const { currency } = await ctx.params;
    const cur = String(currency ?? '').trim();
    if (!cur) throw new Error('Invalid currency');

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const clauses: string[] = ['currency = $1'];
    const params: any[] = [cur];
    if (from) {
      params.push(from);
      clauses.push(`release_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      clauses.push(`release_date <= $${params.length}::date`);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const rows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          source_name,
          source_page_id,
          source_url,
          country,
          currency,
          central_bank,
          event_name,
          normalized_event_name,
          release_date::text AS release_date,
          release_time,
          actual_rate,
          forecast_rate,
          previous_rate,
          rate_change_bps,
          decision_type,
          surprise_direction,
          policy_bias,
          data_quality_status,
          source_reliability_score,
          captured_at::text AS captured_at,
          last_checked_at::text AS last_checked_at,
          updated_at::text AS updated_at
        FROM rate_decision_history
        ${where}
        ORDER BY release_date DESC
        LIMIT 1200
      `,
      params,
    );

    return NextResponse.json(
      { ok: true, generatedAt: new Date().toISOString(), currency: cur, records: rows.rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = (error as any)?.code;
    if (code === '42P01') {
      return NextResponse.json(
        { ok: false, generatedAt: new Date().toISOString(), currency: null, records: [], error: 'Missing rate decision tables. Run database migration 013_rate_decision_history.sql.' },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'rate_history_currency_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
