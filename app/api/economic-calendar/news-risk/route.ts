import { NextResponse } from 'next/server';
import { ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';
import { queryPostgres } from '@/lib/postgres';

export const dynamic = 'force-dynamic';

type NewsRiskEventRow = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  country: string;
  currency: string;
  impact_level: string;
  event_date: string;
  event_time: string | null;
  utc_event_time: string | null;
  trade_restriction_required: boolean;
  restriction_start_time: string | null;
  restriction_end_time: string | null;
  status: string;
  source_url: string | null;
  affected_pairs: unknown;
  updated_at: string;
};

type WindowKey = '24h' | '7d' | '30d' | '90d';
type StatusKey = 'all' | 'active' | 'upcoming' | 'recent';

const defaultCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_ECONOMIC_CALENDAR_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Economic Calendar requires local machine access.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Economic Calendar requires local machine access.');
  }
}

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function minutes(n: number): number {
  return n * 60_000;
}

function impactMinutes(impactLevel: string, side: 'pre' | 'post'): number {
  const level = String(impactLevel ?? '').toLowerCase();
  const critical = level === 'critical';
  const high = level === 'high';
  if (side === 'pre') return critical ? 75 : high ? 45 : 30;
  return critical ? 90 : high ? 60 : 45;
}

function computeWindow(row: NewsRiskEventRow): { startIso: string | null; endIso: string | null } {
  const startTs = parseIso(row.restriction_start_time);
  const endTs = parseIso(row.restriction_end_time);
  if (startTs != null && endTs != null) {
    return { startIso: new Date(startTs).toISOString(), endIso: new Date(endTs).toISOString() };
  }
  const utcTs = parseIso(row.utc_event_time);
  if (utcTs == null) return { startIso: null, endIso: null };
  const start = utcTs - minutes(impactMinutes(row.impact_level, 'pre'));
  const end = utcTs + minutes(impactMinutes(row.impact_level, 'post'));
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

function statusForWindow(nowTs: number, startIso: string | null, endIso: string | null): 'active' | 'upcoming' | 'recent' | 'unknown' {
  const startTs = parseIso(startIso);
  const endTs = parseIso(endIso);
  if (startTs == null || endTs == null) return 'unknown';
  if (nowTs >= startTs && nowTs <= endTs) return 'active';
  if (nowTs < startTs) return 'upcoming';
  return 'recent';
}

function horizonRange(nowTs: number, windowKey: WindowKey): { fromTs: number; toTs: number } {
  const toTs =
    windowKey === '24h'
      ? nowTs + 24 * 60 * 60_000
      : windowKey === '7d'
        ? nowTs + 7 * 24 * 60 * 60_000
        : windowKey === '30d'
          ? nowTs + 30 * 24 * 60 * 60_000
          : nowTs + 90 * 24 * 60 * 60_000;
  const fromTs = nowTs - 12 * 60 * 60_000;
  return { fromTs, toTs };
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function dateList(fromIso: string, toIso: string): string[] {
  const start = new Date(`${fromIso}T00:00:00.000Z`);
  const end = new Date(`${toIso}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (out.length > 500) break;
  }
  return out;
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    ensureEconomicCalendarWorkerStarted();

    const url = new URL(request.url);
    const windowKey = (String(url.searchParams.get('window') ?? '7d').trim().toLowerCase() || '7d') as WindowKey;
    const statusKey = (String(url.searchParams.get('status') ?? 'all').trim().toLowerCase() || 'all') as StatusKey;
    const currencies = splitCsv(url.searchParams.get('currency'));
    const effectiveCurrencies = currencies.length ? currencies : Array.from(defaultCurrencies);
    const view = String(url.searchParams.get('view') ?? 'dashboard').trim().toLowerCase();

    const nowTs = Date.now();
    const range = horizonRange(nowTs, windowKey);
    const fromDate = isoDate(range.fromTs);
    const toDate = isoDate(range.toTs);

    if (view === 'timeline') {
      const days = Math.max(7, Math.min(180, Number(url.searchParams.get('days') ?? 45) || 45));
      const fromTs = nowTs - days * 24 * 60 * 60_000;
      const from = isoDate(fromTs);
      const to = isoDate(nowTs);
      const keys = dateList(from, to);
      const buckets: Record<string, { date: string; active: number; upcoming: number; ended: number; critical: number }> = Object.fromEntries(
        keys.map((d) => [d, { date: d, active: 0, upcoming: 0, ended: 0, critical: 0 }]),
      );

      const timelineRows = await queryPostgres(
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
            trade_restriction_required,
            restriction_start_time::text AS restriction_start_time,
            restriction_end_time::text AS restriction_end_time,
            status,
            source_url,
            affected_pairs,
            updated_at::text AS updated_at
          FROM economic_events
          WHERE (trade_restriction_required = true OR restriction_start_time IS NOT NULL OR restriction_end_time IS NOT NULL)
            AND event_date >= $1::date
            AND event_date <= $2::date
            AND currency = ANY($3::text[])
          ORDER BY event_date ASC
          LIMIT 2000
        `,
        [from, to, effectiveCurrencies],
      ).then((r) => r.rows as unknown as NewsRiskEventRow[]);

      for (const row of timelineRows) {
        const computed = computeWindow(row);
        const startTs = parseIso(computed.startIso);
        const endTs = parseIso(computed.endIso);
        if (startTs == null || endTs == null) continue;

        const dayKey = String(row.event_date ?? '');
        const bucket = buckets[dayKey];
        if (!bucket) continue;
        const s = statusForWindow(Date.parse(`${dayKey}T12:00:00.000Z`), computed.startIso, computed.endIso);
        if (s === 'active') bucket.active += 1;
        if (s === 'upcoming') bucket.upcoming += 1;
        if (s === 'recent') bucket.ended += 1;
        if (String(row.impact_level ?? '') === 'Critical') bucket.critical += 1;
      }

      return NextResponse.json(
        { ok: true, generatedAt: new Date().toISOString(), days, from, to, points: Object.values(buckets) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const clauses: string[] = [
      `(trade_restriction_required = true OR restriction_start_time IS NOT NULL OR restriction_end_time IS NOT NULL)`,
      `event_date >= $1::date`,
      `event_date <= $2::date`,
    ];
    const params: any[] = [fromDate, toDate, effectiveCurrencies];
    clauses.push(`currency = ANY($3::text[])`);

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
          trade_restriction_required,
          restriction_start_time::text AS restriction_start_time,
          restriction_end_time::text AS restriction_end_time,
          status,
          source_url,
          affected_pairs,
          updated_at::text AS updated_at
        FROM economic_events
        ${where}
        ORDER BY event_date ASC, utc_event_time ASC NULLS LAST, updated_at DESC
        LIMIT 1800
      `,
      params,
    ).then((r) => r.rows as unknown as NewsRiskEventRow[]);

    const enriched = rows
      .map((row) => {
        const computed = computeWindow(row);
        const windowStatus = statusForWindow(nowTs, computed.startIso, computed.endIso);
        return { ...row, window_start: computed.startIso, window_end: computed.endIso, window_status: windowStatus };
      })
      .filter((row: any) => {
        if (statusKey === 'all') return true;
        return row.window_status === statusKey;
      });

    const currenciesSeen = Array.from(new Set(enriched.map((r: any) => String(r.currency ?? '').trim().toUpperCase()).filter(Boolean))).sort();

    const summaryByCurrency: Record<string, { active: number; upcoming: number; recent: number; criticalUpcoming: number }> = {};
    for (const row of enriched as any[]) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (!summaryByCurrency[cur]) summaryByCurrency[cur] = { active: 0, upcoming: 0, recent: 0, criticalUpcoming: 0 };
      if (row.window_status === 'active') summaryByCurrency[cur].active += 1;
      if (row.window_status === 'upcoming') {
        summaryByCurrency[cur].upcoming += 1;
        if (String(row.impact_level ?? '') === 'Critical') summaryByCurrency[cur].criticalUpcoming += 1;
      }
      if (row.window_status === 'recent') summaryByCurrency[cur].recent += 1;
    }

    const active = (enriched as any[]).filter((r) => r.window_status === 'active');
    const upcoming = (enriched as any[]).filter((r) => r.window_status === 'upcoming');
    const recent = (enriched as any[]).filter((r) => r.window_status === 'recent');

    const next24hTs = nowTs + 24 * 60 * 60_000;
    const upcomingNext24h = upcoming.filter((r) => {
      const startTs = parseIso(String(r.window_start ?? null));
      if (startTs == null) return false;
      return startTs >= nowTs && startTs <= next24hTs;
    });

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        filters: { window: windowKey, fromDate, toDate, currencies: effectiveCurrencies, status: statusKey },
        universe: { currencies: currenciesSeen },
        summary: {
          total: enriched.length,
          activeNow: active.length,
          upcoming: upcoming.length,
          upcomingNext24h: upcomingNext24h.length,
          endedRecently: recent.length,
          criticalUpcoming: upcoming.filter((r) => String(r.impact_level ?? '') === 'Critical').length,
          byCurrency: summaryByCurrency,
        },
        active: active.slice(0, 250),
        upcoming: upcoming.slice(0, 350),
        recent: recent.slice(0, 300),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'news_risk_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
