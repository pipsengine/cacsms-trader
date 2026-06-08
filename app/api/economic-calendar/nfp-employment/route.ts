import { NextResponse } from 'next/server';
import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';
import { ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';
import { queryPostgres } from '@/lib/postgres';

export const dynamic = 'force-dynamic';

type EmploymentKind =
  | 'nfp'
  | 'unemployment_rate'
  | 'avg_hourly_earnings'
  | 'jobless_claims'
  | 'employment_change'
  | 'adp'
  | 'unknown';

type EmploymentEventRow = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  country: string;
  currency: string;
  impact_level: string;
  event_date: string;
  event_time: string | null;
  utc_event_time: string | null;
  actual_value: string | null;
  forecast_value: string | null;
  previous_value: string | null;
  revised_previous_value: string | null;
  surprise_value: number | null;
  surprise_direction: string | null;
  status: string;
  source_url: string | null;
  updated_at: string;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

function daysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function inferEmploymentKind(normalizedName: string): EmploymentKind {
  const s = normalizedName.toLowerCase();
  if (/\bnon[-\s]?farm\b|\bnonfarm\b|\bpayrolls?\b|\bnfp\b/.test(s)) return 'nfp';
  if (/\bunemployment\b/.test(s) && /\brate\b|\b%\b/.test(s)) return 'unemployment_rate';
  if (/\bavg\b.*\bhourly\b.*\bearnings\b|\baverage hourly earnings\b/.test(s)) return 'avg_hourly_earnings';
  if (/\bjobless\b|\bclaims?\b/.test(s)) return 'jobless_claims';
  if (/\bemployment\b.*\bchange\b|\bchange in employment\b|\bemployment change\b/.test(s)) return 'employment_change';
  if (/\badp\b/.test(s)) return 'adp';
  return 'unknown';
}

function isReleased(row: EmploymentEventRow): boolean {
  const actual = String(row.actual_value ?? '').trim();
  if (actual) return true;
  return ['RELEASED', 'ANALYZED', 'ARCHIVED'].includes(String(row.status ?? '').toUpperCase());
}

function isUpcoming(row: EmploymentEventRow): boolean {
  const status = String(row.status ?? '').toUpperCase();
  if (['UPCOMING', 'SCHEDULED', 'PRE_MONITORING', 'WATCHING'].includes(status)) return true;
  return !isReleased(row);
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertEconomicCalendarAccess(request);
    ensureEconomicCalendarWorkerStarted();

    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? daysAgo(365);
    const to = url.searchParams.get('to') ?? daysAhead(90);
    const currencies = splitCsv(url.searchParams.get('currency'));
    const impactLevels = splitCsv(url.searchParams.get('impact'));
    const kindFilter = String(url.searchParams.get('kind') ?? '').trim().toLowerCase();
    const view = String(url.searchParams.get('view') ?? 'dashboard').trim().toLowerCase();

    const patterns = [
      '%nonfarm%',
      '%non-farm%',
      '%payroll%',
      '%nfp%',
      '%unemployment%',
      '%employment%',
      '%jobless%',
      '%claims%',
      '%average hourly earnings%',
      '%avg hourly earnings%',
      '%adp%',
      '%participation rate%',
    ];

    const clauses: string[] = [
      `event_date >= $1::date`,
      `event_date <= $2::date`,
      `(normalized_event_name ILIKE ANY($3::text[]) OR event_name ILIKE ANY($3::text[]))`,
    ];
    const params: any[] = [from, to, patterns];

    if (currencies.length) {
      params.push(currencies);
      clauses.push(`currency = ANY($${params.length}::text[])`);
    }
    if (impactLevels.length) {
      params.push(impactLevels);
      clauses.push(`impact_level = ANY($${params.length}::text[])`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const baseRows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_name,
          normalized_event_name,
          country,
          currency,
          impact_level,
          event_date::text AS event_date,
          event_time::text AS event_time,
          utc_event_time::text AS utc_event_time,
          actual_value,
          forecast_value,
          previous_value,
          revised_previous_value,
          surprise_value,
          surprise_direction,
          status,
          source_url,
          updated_at::text AS updated_at
        FROM economic_events
        ${where}
        ORDER BY event_date DESC, utc_event_time DESC NULLS LAST, updated_at DESC
        LIMIT 1400
      `,
      params,
    ).then((r) => r.rows as unknown as EmploymentEventRow[]);

    const decorated = baseRows
      .map((row) => ({
        ...row,
        kind: inferEmploymentKind(String(row.normalized_event_name ?? '')),
        released: isReleased(row),
      }))
      .filter((row) => {
        if (!kindFilter) return true;
        return row.kind === kindFilter;
      });

    if (view === 'series') {
      const currency = String(url.searchParams.get('currency') ?? '').trim().toUpperCase();
      if (!currency) {
        return NextResponse.json({ ok: false, error: 'currency is required for view=series.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      }
      const kind = String(url.searchParams.get('kind') ?? '').trim().toLowerCase() as EmploymentKind;
      const series = decorated
        .filter((row) => String(row.currency ?? '').toUpperCase() === currency)
        .filter((row) => !kind || row.kind === kind)
        .filter((row) => row.released)
        .map((row) => ({
          id: row.id,
          currency: row.currency,
          country: row.country,
          eventName: row.event_name,
          kind: (row as any).kind as EmploymentKind,
          eventDate: row.event_date,
          eventTime: row.event_time,
          utcEventTime: row.utc_event_time,
          actualValue: row.actual_value,
          forecastValue: row.forecast_value,
          previousValue: row.revised_previous_value ?? row.previous_value,
          impactLevel: row.impact_level,
          status: row.status,
          sourceUrl: row.source_url,
          updatedAt: row.updated_at,
        }))
        .sort((a, b) => (a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1 : 0))
        .slice(-100);

      return NextResponse.json(
        {
          ok: true,
          generatedAt: new Date().toISOString(),
          currency,
          kind: kind || null,
          from,
          to,
          series,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const today = isoDate(new Date());
    const upcoming = decorated
      .filter((row) => isUpcoming(row))
      .filter((row) => row.event_date >= today)
      .sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0))
      .slice(0, 250);

    const recent = decorated
      .filter((row) => row.released)
      .sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : 0))
      .slice(0, 450);

    const currenciesSeen = Array.from(new Set(decorated.map((r) => String(r.currency ?? '').trim().toUpperCase()).filter(Boolean))).sort();
    const kindsSeen = Array.from(new Set(decorated.map((r: any) => String(r.kind ?? 'unknown')))).sort();

    const upcomingByCurrency: Record<string, number> = {};
    for (const row of upcoming) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      upcomingByCurrency[cur] = (upcomingByCurrency[cur] ?? 0) + 1;
    }

    const lastReleaseByCurrency: Record<
      string,
      { eventDate: string; actualValue: string | null; forecastValue: string | null; previousValue: string | null; eventName: string }
    > = {};
    for (const row of recent) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (lastReleaseByCurrency[cur]) continue;
      lastReleaseByCurrency[cur] = {
        eventDate: row.event_date,
        actualValue: row.actual_value,
        forecastValue: row.forecast_value,
        previousValue: row.revised_previous_value ?? row.previous_value,
        eventName: row.event_name,
      };
    }

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        filters: { from, to, currencies, impactLevels, kind: kindFilter || null },
        universe: { currencies: currenciesSeen, kinds: kindsSeen },
        summary: {
          total: decorated.length,
          upcoming: upcoming.length,
          released: recent.length,
          upcomingByCurrency,
          lastReleaseByCurrency,
        },
        upcoming,
        recent,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'nfp_employment_failed', summary: null, upcoming: [], recent: [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

