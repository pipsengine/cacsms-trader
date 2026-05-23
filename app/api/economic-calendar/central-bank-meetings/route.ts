import { NextResponse } from 'next/server';
import { ensureEconomicCalendarWorkerStarted } from '@/services/economic-data-service/src/economic-calendar-intelligence';
import { queryPostgres } from '@/lib/postgres';

export const dynamic = 'force-dynamic';

type CentralBankKind = 'rate_decision' | 'minutes' | 'statement' | 'press_conference' | 'speech' | 'meeting' | 'unknown';

type CentralBankEventRow = {
  id: string;
  event_name: string;
  normalized_event_name: string;
  country: string;
  currency: string;
  impact_level: string;
  unit: string | null;
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

function inferCentralBankKind(normalizedName: string): CentralBankKind {
  const s = normalizedName.toLowerCase();
  if (/\binterest rate decision\b|\brate decision\b|\bpolicy rate\b/.test(s)) return 'rate_decision';
  if (/\bminutes\b/.test(s)) return 'minutes';
  if (/\bstatement\b|\bmonetary policy statement\b/.test(s)) return 'statement';
  if (/\bpress conference\b|\bpress conf\b/.test(s)) return 'press_conference';
  if (/\bspeech\b|\btestimony\b|\bremarks\b/.test(s)) return 'speech';
  if (/\bmeeting\b|\bcommittee\b|\bpolicy meeting\b/.test(s)) return 'meeting';
  return 'unknown';
}

function isReleased(row: CentralBankEventRow): boolean {
  const actual = String(row.actual_value ?? '').trim();
  if (actual) return true;
  return ['RELEASED', 'ANALYZED', 'ARCHIVED'].includes(String(row.status ?? '').toUpperCase());
}

function isUpcoming(row: CentralBankEventRow): boolean {
  const status = String(row.status ?? '').toUpperCase();
  if (['UPCOMING', 'SCHEDULED', 'PRE_MONITORING', 'WATCHING'].includes(status)) return true;
  return !isReleased(row);
}

function monthKey(dateIso: string): string | null {
  const m = String(dateIso ?? '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m?.[1] || !m?.[2]) return null;
  return `${m[1]}-${m[2]}`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    ensureEconomicCalendarWorkerStarted();

    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? daysAgo(365);
    const to = url.searchParams.get('to') ?? daysAhead(180);
    const currencies = splitCsv(url.searchParams.get('currency'));
    const impactLevels = splitCsv(url.searchParams.get('impact'));
    const kindFilter = String(url.searchParams.get('kind') ?? '').trim().toLowerCase();
    const view = String(url.searchParams.get('view') ?? 'dashboard').trim().toLowerCase();

    const patterns = [
      '%interest rate decision%',
      '%rate decision%',
      '%policy rate%',
      '%monetary policy%',
      '%central bank%',
      '%meeting%',
      '%minutes%',
      '%statement%',
      '%press conference%',
      '%fomc%',
      '%ecb%',
      '%boj%',
      '%boe%',
      '%boc%',
      '%rbnz%',
      '%rba%',
      '%snb%',
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
          unit,
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
        LIMIT 1800
      `,
      params,
    ).then((r) => r.rows as unknown as CentralBankEventRow[]);

    const decorated = baseRows
      .map((row) => ({
        ...row,
        kind: inferCentralBankKind(String(row.normalized_event_name ?? '')),
        released: isReleased(row),
      }))
      .filter((row) => {
        if (!kindFilter) return true;
        return row.kind === kindFilter;
      });

    if (view === 'timeline') {
      const currency = String(url.searchParams.get('currency') ?? '').trim().toUpperCase();
      const kind = String(url.searchParams.get('kind') ?? '').trim().toLowerCase() as CentralBankKind;
      const monthsBack = Math.max(6, Math.min(36, Number(url.searchParams.get('months') ?? 18) || 18));

      const end = new Date();
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      start.setUTCMonth(start.getUTCMonth() - (monthsBack - 1));

      const monthBuckets: Record<string, { month: string; count: number; released: number; upcoming: number }> = {};
      for (let i = 0; i < monthsBack; i += 1) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        monthBuckets[key] = { month: key, count: 0, released: 0, upcoming: 0 };
      }

      for (const row of decorated) {
        if (currency && String(row.currency ?? '').toUpperCase() !== currency) continue;
        if (kind && row.kind !== kind) continue;
        const mk = monthKey(row.event_date);
        if (!mk || !monthBuckets[mk]) continue;
        monthBuckets[mk].count += 1;
        if (row.released) monthBuckets[mk].released += 1;
        else monthBuckets[mk].upcoming += 1;
      }

      const points = Object.values(monthBuckets).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
      return NextResponse.json(
        {
          ok: true,
          generatedAt: new Date().toISOString(),
          currency: currency || null,
          kind: kind || null,
          months: monthsBack,
          points,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const today = isoDate(new Date());
    const upcoming = decorated
      .filter((row) => isUpcoming(row))
      .filter((row) => row.event_date >= today)
      .sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0))
      .slice(0, 280);

    const recent = decorated
      .filter((row) => row.released)
      .sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : 0))
      .slice(0, 520);

    const currenciesSeen = Array.from(new Set(decorated.map((r) => String(r.currency ?? '').trim().toUpperCase()).filter(Boolean))).sort();
    const kindsSeen = Array.from(new Set(decorated.map((r: any) => String(r.kind ?? 'unknown')))).sort();

    const upcomingByCurrency: Record<string, number> = {};
    const nextMeetingByCurrency: Record<string, { eventDate: string; eventTime: string | null; eventName: string; kind: CentralBankKind; impactLevel: string }> = {};
    for (const row of upcoming) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      upcomingByCurrency[cur] = (upcomingByCurrency[cur] ?? 0) + 1;
      if (!nextMeetingByCurrency[cur]) {
        nextMeetingByCurrency[cur] = {
          eventDate: row.event_date,
          eventTime: row.event_time,
          eventName: row.event_name,
          kind: (row as any).kind as CentralBankKind,
          impactLevel: row.impact_level,
        };
      }
    }

    const lastEventByCurrency: Record<
      string,
      { eventDate: string; actualValue: string | null; forecastValue: string | null; previousValue: string | null; eventName: string; kind: CentralBankKind }
    > = {};
    for (const row of recent) {
      const cur = String(row.currency ?? '').trim().toUpperCase();
      if (!cur) continue;
      if (lastEventByCurrency[cur]) continue;
      lastEventByCurrency[cur] = {
        eventDate: row.event_date,
        actualValue: row.actual_value,
        forecastValue: row.forecast_value,
        previousValue: row.revised_previous_value ?? row.previous_value,
        eventName: row.event_name,
        kind: (row as any).kind as CentralBankKind,
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
          nextMeetingByCurrency,
          lastEventByCurrency,
        },
        upcoming,
        recent,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'central_bank_meetings_failed', summary: null, upcoming: [], recent: [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

