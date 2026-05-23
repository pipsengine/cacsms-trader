export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';
import { ensureCentralBankRateTables, CentralBankRateSchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

const allowedCurrencies = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF']);

export async function GET(request: Request): Promise<Response> {
  try {
    new CentralBankRateSchedulerService().ensureStarted();
    await ensureCentralBankRateTables();

    const url = new URL(request.url);
    const currency = url.searchParams.get('currency');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 500), 1), 2000);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

    const where: string[] = [];
    const params: any[] = [];

    if (currency && allowedCurrencies.has(currency.toUpperCase())) {
      params.push(currency.toUpperCase());
      where.push(`h.currency = $${params.length}`);
    }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(from);
      where.push(`h.release_date >= $${params.length}::date`);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(to);
      where.push(`h.release_date <= $${params.length}::date`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    params.push(offset);

    const rows = await queryPostgres(
      `
        SELECT
          h.id::text AS id,
          h.event_id,
          h.currency,
          e.country,
          COALESCE(h.central_bank, e.central_bank) AS central_bank,
          e.event_name,
          h.release_date::text AS release_date,
          NULLIF(h.release_time, '') AS release_time,
          h.actual_rate,
          h.forecast_rate,
          h.previous_rate,
          h.rate_change,
          h.surprise,
          h.bias,
          h.source_url,
          h.fetched_at::text AS fetched_at,
          h.updated_at::text AS updated_at
        FROM central_bank_rate_history h
        JOIN central_bank_rate_events e ON e.event_id = h.event_id
        ${whereSql}
        ORDER BY h.release_date DESC, h.release_time DESC, h.fetched_at DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params,
    );

    const totalParams = params.slice(0, params.length - 2);
    const total = await queryPostgres(
      `
        SELECT COUNT(*)::int AS total
        FROM central_bank_rate_history h
        ${whereSql}
      `,
      totalParams,
    ).then((r) => Number((r.rows[0] as any)?.total ?? 0));

    return Response.json(
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
    return Response.json(
      { ok: false, generatedAt: new Date().toISOString(), total: 0, limit: 0, offset: 0, records: [], error: error instanceof Error ? error.message : 'rates_history_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
