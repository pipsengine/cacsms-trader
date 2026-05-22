import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { CotWeeklySchedulerService } from '@/services/cot-sync-service/src/cftc-cot-futures-only-collector';

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
    new CotWeeklySchedulerService().ensureStarted();

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const currency = url.searchParams.get('currency');
    const bias = url.searchParams.get('bias');
    const year = url.searchParams.get('year');
    const search = url.searchParams.get('search');
    limit = parseLimit(url.searchParams.get('limit'), 250, 2000);
    offset = parseOffset(url.searchParams.get('offset'));

    const clauses: string[] = [`report_type = 'FUTURES_ONLY'`];
    const params: any[] = [];

    if (from) {
      params.push(from);
      clauses.push(`report_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      clauses.push(`report_date <= $${params.length}::date`);
    }
    if (currency && currency !== 'All') {
      params.push(currency);
      clauses.push(`currency = $${params.length}`);
    }
    if (bias && bias !== 'All') {
      params.push(bias);
      clauses.push(`bias = $${params.length}`);
    }
    if (year && year !== 'All') {
      params.push(Number(year));
      clauses.push(`source_year = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      clauses.push(`LOWER(COALESCE(market_name, raw_contract_market_name, '')) LIKE $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await queryPostgres(
      `
        SELECT COUNT(*)::int AS total
        FROM cot_institutional_positions
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
          report_date,
          currency,
          long_positions,
          short_positions,
          change_long,
          change_short,
          percent_change,
          net_positions,
          bias,
          market_name,
          cftc_market_code,
          exchange,
          source_url,
          source_year,
          net_change,
          bias_strength,
          raw_contract_market_name,
          created_at,
          updated_at
        FROM cot_institutional_positions
        ${where}
        ORDER BY report_date DESC, currency ASC
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
          error: 'Missing COT tables. Run database migration 012_cot_institutional_positions.sql.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'cot_positions_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
