import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { ensureRateDecisionHistoryTables, InvestingRateDecisionWeeklySchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(value: unknown): string {
  const raw = value == null ? '' : String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export async function GET(request: Request) {
  try {
    new InvestingRateDecisionWeeklySchedulerService().ensureStarted();
    await ensureRateDecisionHistoryTables();

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const currency = url.searchParams.get('currency');
    const decisionType = url.searchParams.get('decisionType');
    const surprise = url.searchParams.get('surprise');
    const pageId = url.searchParams.get('sourcePageId');
    const search = url.searchParams.get('search');

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
    const result = await queryPostgres(
      `
        SELECT
          release_date::date::text AS release_date,
          country,
          currency,
          central_bank,
          actual_rate,
          forecast_rate,
          previous_rate,
          rate_change_bps,
          decision_type,
          surprise_direction,
          policy_bias,
          source_page_id,
          source_name,
          captured_at::text AS captured_at
        FROM rate_decision_history
        ${where}
        ORDER BY release_date::date DESC, currency ASC
      `,
      params,
    );

    const header = [
      'Date',
      'Country',
      'Currency',
      'Central Bank',
      'Actual Rate',
      'Forecast Rate',
      'Previous Rate',
      'Change BPS',
      'Decision Type',
      'Surprise',
      'Policy Bias',
      'Source Page ID',
      'Source',
      'Captured At',
    ];

    const lines = [header.join(',')];
    for (const row of result.rows as any[]) {
      lines.push(
        [
          csvEscape(row.release_date ?? ''),
          csvEscape(row.country ?? ''),
          csvEscape(row.currency ?? ''),
          csvEscape(row.central_bank ?? ''),
          csvEscape(row.actual_rate ?? ''),
          csvEscape(row.forecast_rate ?? ''),
          csvEscape(row.previous_rate ?? ''),
          csvEscape(row.rate_change_bps ?? ''),
          csvEscape(row.decision_type ?? ''),
          csvEscape(row.surprise_direction ?? ''),
          csvEscape(row.policy_bias ?? ''),
          csvEscape(row.source_page_id ?? ''),
          csvEscape(row.source_name ?? ''),
          csvEscape(row.captured_at ?? ''),
        ].join(','),
      );
    }

    const csv = lines.join('\n');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cacsms-rate-decision-history.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === '42P01') {
      const header = [
        'Date',
        'Country',
        'Currency',
        'Central Bank',
        'Actual Rate',
        'Forecast Rate',
        'Previous Rate',
        'Change BPS',
        'Decision Type',
        'Surprise',
        'Policy Bias',
        'Source Page ID',
        'Source',
        'Captured At',
      ];
      return new NextResponse(header.join(',') + '\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="cacsms-rate-decision-history.csv"`,
          'Cache-Control': 'no-store',
          'X-Cacsms-Warning': 'Missing rate decision tables. Run database migration 013_rate_decision_history.sql.',
        },
      });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'rate_history_export_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
