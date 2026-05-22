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

function parseOffset(value: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

export async function GET(request: Request) {
  let limit = 250;
  let offset = 0;
  try {
    new InvestingRateDecisionWeeklySchedulerService().ensureStarted();
    await ensureRateDecisionHistoryTables();

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const currency = url.searchParams.get('currency');
    const country = url.searchParams.get('country');
    const centralBank = url.searchParams.get('centralBank');
    const decisionType = url.searchParams.get('decisionType');
    const surprise = url.searchParams.get('surprise');
    const pageId = url.searchParams.get('sourcePageId');
    const search = url.searchParams.get('search');
    limit = parseLimit(url.searchParams.get('limit'), 250, 2000);
    offset = parseOffset(url.searchParams.get('offset'));

    const clauses: string[] = [];
    const params: any[] = [];

    if (from) {
      params.push(from);
      clauses.push(`release_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      clauses.push(`release_date <= $${params.length}::date`);
    }
    if (currency && currency !== 'All') {
      params.push(currency);
      clauses.push(`currency = $${params.length}`);
    }
    if (country && country !== 'All') {
      params.push(country);
      clauses.push(`country = $${params.length}`);
    }
    if (centralBank && centralBank !== 'All') {
      params.push(centralBank);
      clauses.push(`central_bank = $${params.length}`);
    }
    if (decisionType && decisionType !== 'All') {
      params.push(decisionType);
      clauses.push(`decision_type = $${params.length}`);
    }
    if (surprise && surprise !== 'All') {
      params.push(surprise);
      clauses.push(`surprise_direction = $${params.length}`);
    }
    if (pageId && pageId !== 'All') {
      const n = Number(pageId);
      if (Number.isFinite(n)) {
        params.push(Math.round(n));
        clauses.push(`source_page_id = $${params.length}`);
      }
    }
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      clauses.push(`LOWER(COALESCE(event_name, normalized_event_name, central_bank, country, currency, '')) LIKE $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await queryPostgres(
      `
        SELECT COUNT(*)::int AS total
        FROM rate_decision_history
        ${where}
      `,
      params,
    );
    const total = Number((countResult.rows[0] as any)?.total ?? 0);

    const pageParams = params.slice();
    pageParams.push(limit);
    pageParams.push(offset);

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
        ORDER BY release_date DESC, currency ASC
        LIMIT $${pageParams.length - 1}
        OFFSET $${pageParams.length}
      `,
      pageParams,
    );

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        total,
        limit,
        offset,
        records: rows.rows,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = (error as any)?.code;
    if (code === '42P01') {
      return NextResponse.json(
        {
          ok: false,
          generatedAt: new Date().toISOString(),
          total: 0,
          limit,
          offset,
          records: [],
          error: 'Missing rate decision tables. Run database migration 013_rate_decision_history.sql.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'rate_history_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
