import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { CotWeeklySchedulerService } from '@/services/cot-sync-service/src/cftc-cot-futures-only-collector';

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
    new CotWeeklySchedulerService().ensureStarted();

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const currency = url.searchParams.get('currency');
    const bias = url.searchParams.get('bias');
    const year = url.searchParams.get('year');
    const search = url.searchParams.get('search');

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
      params.push(currency === 'USD Index' ? 'USD' : currency);
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
    const result = await queryPostgres(
      `
        SELECT
          report_date::date::text AS report_date,
          currency,
          long_positions,
          short_positions,
          change_long,
          change_short,
          percent_change,
          net_positions,
          bias,
          net_change,
          market_name,
          cftc_market_code,
          exchange,
          source_year,
          source_url
        FROM cot_institutional_positions
        ${where}
        ORDER BY report_date::date DESC, currency ASC
      `,
      params,
    );

    const header = [
      'Date',
      'Currency',
      'Long',
      'Short',
      'Change Long',
      'Change Short',
      '%Change',
      'Net Positions',
      'Bias',
      'Net Change',
      'Market Name',
      'CFTC Market Code',
      'Exchange',
      'Source Year',
      'Source URL',
    ];

    const lines = [header.join(',')];
    for (const row of result.rows as any[]) {
      lines.push(
        [
          csvEscape(row.report_date ?? ''),
          csvEscape(row.currency ?? ''),
          csvEscape(row.long_positions ?? ''),
          csvEscape(row.short_positions ?? ''),
          csvEscape(row.change_long ?? ''),
          csvEscape(row.change_short ?? ''),
          csvEscape(row.percent_change ?? ''),
          csvEscape(row.net_positions ?? ''),
          csvEscape(row.bias ?? ''),
          csvEscape(row.net_change ?? ''),
          csvEscape(row.market_name ?? ''),
          csvEscape(row.cftc_market_code ?? ''),
          csvEscape(row.exchange ?? ''),
          csvEscape(row.source_year ?? ''),
          csvEscape(row.source_url ?? ''),
        ].join(','),
      );
    }

    const csv = lines.join('\n');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cacsms-cot-futures-only.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === '42P01') {
      const header = [
        'Date',
        'Currency',
        'Long',
        'Short',
        'Change Long',
        'Change Short',
        '%Change',
        'Net Positions',
        'Bias',
        'Net Change',
        'Market Name',
        'CFTC Market Code',
        'Exchange',
        'Source Year',
        'Source URL',
      ];
      return new NextResponse(header.join(',') + '\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="cacsms-cot-futures-only.csv"`,
          'Cache-Control': 'no-store',
          'X-Cacsms-Warning': 'Missing COT tables. Run database migration 012_cot_institutional_positions.sql.',
        },
      });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'cot_export_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
