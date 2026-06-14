export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';
import { assertLocalToolAccess } from '@/lib/local-access';
import { bootstrapCentralBankRatesFromSeed } from '@/lib/rates/bootstrap-central-bank-rates';
import {
  CENTRAL_BANK_RATE_EVENT_PAGES,
  centralBankEventIdByCurrency,
  resolveCentralBankRatePageId,
} from '@/lib/rates/central-bank-rate-event-pages';
import { ensureCentralBankRateTables, CentralBankRateHistoryCollectorService, CentralBankRateSchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

const eventMetaById = CENTRAL_BANK_RATE_EVENT_PAGES;
const eventIdByCurrency = centralBankEventIdByCurrency;

function parseRateText(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw.toLowerCase() === 'n/a' || raw === '—') return null;
  const cleaned = raw.replaceAll('%', '').replaceAll(',', '').replaceAll(' ', '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMdyDateToIso(value: string): string | null {
  const raw = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
  const m = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const monthMap: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const mm = monthMap[m[1].toLowerCase()] ?? '';
  if (!mm) return null;
  const dd = String(Number(m[2])).padStart(2, '0');
  const yyyy = m[3];
  const iso = `${yyyy}-${mm}-${dd}`;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? iso : null;
}

function computeBias(currency: string, actual: number | null, forecast: number | null): string | null {
  if (actual == null || forecast == null) return null;
  if (actual > forecast) return `Bullish ${currency}`;
  if (actual < forecast) return `Bearish ${currency}`;
  return `Neutral ${currency}`;
}

function computeRateChange(actual: number | null, previous: number | null): number | null {
  if (actual == null || previous == null) return null;
  return actual - previous;
}

function computeSurprise(actual: number | null, forecast: number | null): number | null {
  if (actual == null || forecast == null) return null;
  return actual - forecast;
}

function parsePastedHistoryRows(inputText: string): Array<{ releaseDate: string; releaseTime: string; actualRate: number | null; forecastRate: number | null; previousRate: number | null }> {
  const text = String(inputText ?? '');
  const lower = text.toLowerCase();
  const start = lower.indexOf('release date');
  const slice = start >= 0 ? text.slice(start) : text;
  const normalized = slice.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');

  const rows: Array<{ releaseDate: string; releaseTime: string; actualRate: number | null; forecastRate: number | null; previousRate: number | null }> = [];
  const re = /([A-Za-z]{3}\s+\d{1,2},\s+\d{4}(?:\s*\([^)]+\))?)\s+(\d{2}:\d{2})\s+((?:-?\d+(?:\.\d+)?%)|—|-|n\/a)?\s+((?:-?\d+(?:\.\d+)?%)|—|-|n\/a)?\s+((?:-?\d+(?:\.\d+)?%)|—|-|n\/a)?/gi;
  for (const m of normalized.matchAll(re)) {
    const dateIso = parseMdyDateToIso(m[1] ?? '');
    const timeText = String(m[2] ?? '').trim();
    if (!dateIso || !timeText) continue;
    const actualRate = parseRateText(m[3]);
    const forecastRate = parseRateText(m[4]);
    const previousRate = parseRateText(m[5]);
    rows.push({ releaseDate: dateIso, releaseTime: timeText, actualRate, forecastRate, previousRate });
  }

  const dedup = new Map<string, (typeof rows)[number]>();
  for (const r of rows) dedup.set(`${r.releaseDate}|${r.releaseTime}`, r);
  return Array.from(dedup.values()).sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : a.releaseDate > b.releaseDate ? -1 : a.releaseTime < b.releaseTime ? 1 : a.releaseTime > b.releaseTime ? -1 : 0));
}

function assertLocalOnly(request: Request) {
  assertLocalToolAccess(request, 'Rates sync requires local machine access.');
}

function assertRateLimit(key: string, windowMs: number) {
  const globalAny = globalThis as unknown as { __cacsmsRateLimits?: Map<string, number> };
  if (!globalAny.__cacsmsRateLimits) globalAny.__cacsmsRateLimits = new Map();
  const now = Date.now();
  const last = globalAny.__cacsmsRateLimits.get(key) ?? 0;
  if (now - last < windowMs) throw new Error('rate_limited');
  globalAny.__cacsmsRateLimits.set(key, now);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const collector = new CentralBankRateHistoryCollectorService();
    new CentralBankRateSchedulerService().ensureStarted();
    await ensureCentralBankRateTables();
    await collector.registerAllEventPages();

    const tablesOk = await queryPostgres(
      `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('central_bank_rate_events','central_bank_rate_history','rate_sync_logs')
        GROUP BY table_schema
        HAVING COUNT(*) >= 3
      `,
    )
      .then((r) => (r.rows?.length ?? 0) > 0)
      .catch(() => false);
    if (!tablesOk) {
      return Response.json(
        { ok: false, error: 'Missing rate tables. Apply database migration 014_central_bank_rate_history.sql.' },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    assertLocalOnly(request);
    assertRateLimit('rates:sync', 60_000);

    const body = await request
      .json()
      .catch(() => null as null | { mode?: string; scope?: string; currency?: string; eventId?: number; pastedText?: string; sourceUrl?: string });

    if (body && String(body.mode ?? '').toLowerCase() === 'seed') {
      const result = await bootstrapCentralBankRatesFromSeed(Boolean((body as { force?: boolean }).force));
      return Response.json({ mode: 'seed', ...result }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    if (body && String(body.mode ?? '').toLowerCase() === 'paste') {
      const currency = String(body.currency ?? '').trim().toUpperCase();
      const eventId = Number.isFinite(Number(body.eventId)) ? Number(body.eventId) : currency ? eventIdByCurrency[currency] : null;
      if (!eventId || !eventMetaById[eventId]) {
        return Response.json({ ok: false, error: 'Invalid currency/eventId for paste import.' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
      }
      const pastedText = String(body.pastedText ?? '');
      if (!pastedText.trim()) {
        return Response.json({ ok: false, error: 'Paste import requires pastedText.' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
      }

      const meta = eventMetaById[eventId];
      const rows = parsePastedHistoryRows(pastedText);
      if (!rows.length) {
        return Response.json({ ok: false, error: 'No rows parsed from pasted text. Make sure the table contains “Release date Time Actual Forecast Previous”.' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
      }

      const sourceUrl = String(body.sourceUrl ?? meta.investingUrl);
      await queryPostgres(
        `
          INSERT INTO central_bank_rate_events (
            event_id,
            currency,
            country,
            central_bank,
            event_name,
            investing_url,
            is_active,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,true, now(), now())
          ON CONFLICT (event_id)
          DO UPDATE SET
            currency = EXCLUDED.currency,
            country = COALESCE(central_bank_rate_events.country, EXCLUDED.country),
            central_bank = COALESCE(central_bank_rate_events.central_bank, EXCLUDED.central_bank),
            event_name = COALESCE(central_bank_rate_events.event_name, EXCLUDED.event_name),
            investing_url = COALESCE(central_bank_rate_events.investing_url, EXCLUDED.investing_url),
            is_active = true,
            updated_at = now()
        `,
        [eventId, meta.currency, meta.country, meta.centralBank, meta.eventName, sourceUrl],
      );

      let inserted = 0;
      let updated = 0;
      const fetchedAtIso = new Date().toISOString();
      for (const r of rows) {
        const rateChange = computeRateChange(r.actualRate, r.previousRate);
        const surprise = computeSurprise(r.actualRate, r.forecastRate);
        const bias = computeBias(meta.currency, r.actualRate, r.forecastRate);
        const result = await queryPostgres(
          `
            INSERT INTO central_bank_rate_history (
              event_id,
              currency,
              central_bank,
              release_date,
              release_time,
              actual_rate,
              forecast_rate,
              previous_rate,
              rate_change,
              surprise,
              bias,
              source_url,
              fetched_at,
              created_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz, now(), now())
            ON CONFLICT (event_id, currency, release_date, release_time)
            DO UPDATE SET
              central_bank = COALESCE(central_bank_rate_history.central_bank, EXCLUDED.central_bank),
              actual_rate = CASE WHEN EXCLUDED.actual_rate IS NOT NULL THEN EXCLUDED.actual_rate ELSE central_bank_rate_history.actual_rate END,
              forecast_rate = CASE WHEN EXCLUDED.forecast_rate IS NOT NULL THEN EXCLUDED.forecast_rate ELSE central_bank_rate_history.forecast_rate END,
              previous_rate = CASE WHEN EXCLUDED.previous_rate IS NOT NULL THEN EXCLUDED.previous_rate ELSE central_bank_rate_history.previous_rate END,
              rate_change = CASE WHEN EXCLUDED.rate_change IS NOT NULL THEN EXCLUDED.rate_change ELSE central_bank_rate_history.rate_change END,
              surprise = CASE WHEN EXCLUDED.surprise IS NOT NULL THEN EXCLUDED.surprise ELSE central_bank_rate_history.surprise END,
              bias = CASE WHEN EXCLUDED.bias IS NOT NULL THEN EXCLUDED.bias ELSE central_bank_rate_history.bias END,
              source_url = COALESCE(central_bank_rate_history.source_url, EXCLUDED.source_url),
              fetched_at = GREATEST(central_bank_rate_history.fetched_at, EXCLUDED.fetched_at),
              updated_at = now()
            RETURNING (xmax = 0) AS inserted
          `,
          [
            eventId,
            meta.currency,
            meta.centralBank,
            r.releaseDate,
            r.releaseTime,
            r.actualRate,
            r.forecastRate,
            r.previousRate,
            rateChange,
            surprise,
            bias,
            sourceUrl,
            fetchedAtIso,
          ],
        );
        if (Boolean((result.rows?.[0] as { inserted?: boolean })?.inserted)) inserted += 1;
        else updated += 1;
      }

      return Response.json(
        { ok: true, mode: 'paste', eventId, currency: meta.currency, rowsParsed: rows.length, rowsInserted: inserted, rowsUpdated: updated },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const pageId = resolveCentralBankRatePageId({ eventId: body?.eventId, currency: body?.currency });
    const scope = String(body?.scope ?? body?.mode ?? 'latest').toLowerCase();
    const jobType = pageId ? `manual_page_${pageId}` : 'manual_sync';

    let result;
    if (pageId) {
      result =
        scope === 'full'
          ? await collector.syncPageLast3Years(pageId, jobType)
          : await collector.syncPageLatest(pageId, jobType);
      return Response.json(
        { ...result, ok: (result.rowsFetched ?? 0) > 0, mode: 'page', scope, eventId: pageId, currency: eventMetaById[pageId]?.currency ?? null },
        { status: 202, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    result = scope === 'full' ? await collector.syncAllLast3Years(jobType) : await collector.syncAllLatest(jobType);

    if ((result.rowsFetched ?? 0) === 0) {
      return Response.json(
        { ...result, ok: false, mode: scope === 'full' ? 'full' : 'latest', error: result.message || 'No rows fetched from Investing.com (likely blocked or table selector changed).' },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return Response.json(
      { ...result, ok: true, mode: scope === 'full' ? 'full' : 'latest' },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'rates_sync_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(): Promise<Response> {
  const pages = Object.entries(CENTRAL_BANK_RATE_EVENT_PAGES).map(([eventId, meta]) => ({
    eventId: Number(eventId),
    ...meta,
  }));
  return Response.json(
    {
      ok: true,
      pages,
      syncModes: {
        latest: 'Sync recent rows (120-day lookback) from all 8 Investing.com event pages',
        full: 'Sync last 3 years from all 8 pages',
        page: 'Sync one currency via eventId or currency query/body field',
        paste: 'Import pasted table text for one currency',
        seed: 'Bootstrap from bundled seed snapshots',
      },
      scheduler: {
        daily: 'Latest page sync at midnight Africa/Lagos',
        weekly: 'Full 3-year page sync Saturday midnight Africa/Lagos',
        every6Hours: 'Latest page sync every 6 hours',
        every5Minutes: 'Latest page sync every 5 minutes (post-release window)',
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
