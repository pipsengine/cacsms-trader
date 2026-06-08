import { NextResponse } from 'next/server';
import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';
import { ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';
import { queryPostgres } from '@/lib/postgres';

export const dynamic = 'force-dynamic';

type HighImpactEventRow = {
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
  restriction_start_time: string | null;
  restriction_end_time: string | null;
  trade_restriction_required: boolean;
  updated_at: string;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function isReleased(row: HighImpactEventRow): boolean {
  const actual = String(row.actual_value ?? '').trim();
  if (actual) return true;
  return ['RELEASED', 'ANALYZED', 'ARCHIVED'].includes(String(row.status ?? '').toUpperCase());
}

function isUpcoming(row: HighImpactEventRow): boolean {
  const status = String(row.status ?? '').toUpperCase();
  if (['UPCOMING', 'SCHEDULED', 'PRE_MONITORING', 'WATCHING'].includes(status)) return true;
  return !isReleased(row);
}

type WindowKey = 'today' | '24h' | '7d' | '30d' | '90d';

function windowRange(windowKey: WindowKey): { from: string; to: string } {
  if (windowKey === 'today') {
    const today = isoDate(new Date());
    return { from: today, to: today };
  }
  if (windowKey === '24h') return { from: isoDate(new Date()), to: daysAhead(1) };
  if (windowKey === '7d') return { from: isoDate(new Date()), to: daysAhead(7) };
  if (windowKey === '30d') return { from: isoDate(new Date()), to: daysAhead(30) };
  return { from: isoDate(new Date()), to: daysAhead(90) };
}

function dateList(fromIso: string, toIso: string): string[] {
  const start = new Date(`${fromIso}T00:00:00.000Z`);
  const end = new Date(`${toIso}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (out.length > 500) break;
  }
  return out;
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertEconomicCalendarAccess(request);
    ensureEconomicCalendarWorkerStarted();

    const url = new URL(request.url);
    const windowKey = (String(url.searchParams.get('window') ?? '7d').trim().toLowerCase() || '7d') as WindowKey;
    const { from, to } = windowRange(windowKey);
    const currencies = splitCsv(url.searchParams.get('currency'));
    const statusFilter = String(url.searchParams.get('status') ?? 'all').trim().toLowerCase();
    const view = String(url.searchParams.get('view') ?? 'dashboard').trim().toLowerCase();

    const clauses: string[] = [
      `impact_level IN ('High','Critical')`,
      `event_date >= $1::date`,
      `event_date <= $2::date`,
    ];
    const params: any[] = [from, to];
    if (currencies.length) {
      params.push(currencies);
      clauses.push(`currency = ANY($${params.length}::text[])`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const rows = await queryPostgres(
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
          restriction_start_time::text AS restriction_start_time,
          restriction_end_time::text AS restriction_end_time,
          trade_restriction_required,
          updated_at::text AS updated_at
        FROM economic_events
        ${where}
        ORDER BY event_date ASC, utc_event_time ASC NULLS LAST, updated_at DESC
        LIMIT 1800
      `,
      params,
    ).then((r) => r.rows as unknown as HighImpactEventRow[]);

    const decorated = rows.map((row) => ({ ...row, released: isReleased(row) }));
    const filtered =
      statusFilter === 'upcoming'
        ? decorated.filter((r) => isUpcoming(r))
        : statusFilter === 'released'
          ? decorated.filter((r) => r.released)
          : decorated;

    if (view === 'timeline') {
      const days = Number(url.searchParams.get('days') ?? 30) || 30;
      const fromTimeline = daysAgo(Math.max(1, Math.min(180, days)));
      const toTimeline = isoDate(new Date());
      const dayKeys = dateList(fromTimeline, toTimeline);
      const dayCounts: Record<string, { date: string; total: number; released: number; upcoming: number; critical: number }> = Object.fromEntries(
        dayKeys.map((d) => [d, { date: d, total: 0, released: 0, upcoming: 0, critical: 0 }]),
      );

      const timelineRows = await queryPostgres(
        `
          SELECT
            event_date::text AS event_date,
            impact_level,
            actual_value,
            status
          FROM economic_events
          WHERE impact_level IN ('High','Critical')
            AND event_date >= $1::date
            AND event_date <= $2::date
        `,
        [fromTimeline, toTimeline],
      ).then((r) => r.rows as Array<{ event_date: string; impact_level: string; actual_value: string | null; status: string }>);

      for (const row of timelineRows) {
        const key = String(row.event_date ?? '');
        const bucket = dayCounts[key];
        if (!bucket) continue;
        bucket.total += 1;
        if (String(row.impact_level ?? '') === 'Critical') bucket.critical += 1;
        const released = String(row.actual_value ?? '').trim()
          ? true
          : ['RELEASED', 'ANALYZED', 'ARCHIVED'].includes(String(row.status ?? '').toUpperCase());
        if (released) bucket.released += 1;
        else bucket.upcoming += 1;
      }

      const points = Object.values(dayCounts).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return NextResponse.json(
        { ok: true, generatedAt: new Date().toISOString(), days: dayKeys.length, points },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const upcoming = filtered.filter((r) => isUpcoming(r));
    const recent = filtered.filter((r) => r.released).sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : 0));

    const currenciesSeen = Array.from(new Set(filtered.map((r) => String(r.currency ?? '').trim().toUpperCase()).filter(Boolean))).sort();
    const byCurrency: Record<string, { total: number; upcoming: number; released: number; critical: number }> = {};
    for (const row of filtered) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (!byCurrency[cur]) byCurrency[cur] = { total: 0, upcoming: 0, released: 0, critical: 0 };
      byCurrency[cur].total += 1;
      if (String(row.impact_level ?? '') === 'Critical') byCurrency[cur].critical += 1;
      if (row.released) byCurrency[cur].released += 1;
      else byCurrency[cur].upcoming += 1;
    }

    const nextByCurrency: Record<string, { eventDate: string; eventTime: string | null; eventName: string; impactLevel: string; restrictionStart: string | null; restrictionEnd: string | null }> =
      {};
    for (const row of upcoming) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (nextByCurrency[cur]) continue;
      nextByCurrency[cur] = {
        eventDate: row.event_date,
        eventTime: row.event_time,
        eventName: row.event_name,
        impactLevel: row.impact_level,
        restrictionStart: row.restriction_start_time,
        restrictionEnd: row.restriction_end_time,
      };
    }

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        filters: { window: windowKey, from, to, currencies, status: statusFilter },
        universe: { currencies: currenciesSeen },
        summary: {
          total: filtered.length,
          upcoming: upcoming.length,
          released: recent.length,
          critical: filtered.filter((r) => String(r.impact_level ?? '') === 'Critical').length,
          byCurrency,
          nextByCurrency,
        },
        upcoming: upcoming.slice(0, 400),
        recent: recent.slice(0, 500),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'high_impact_failed', summary: null, upcoming: [], recent: [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

