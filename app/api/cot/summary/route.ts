import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { CotWeeklySchedulerService } from '@/services/cot-sync-service/src/cftc-cot-futures-only-collector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    new CotWeeklySchedulerService().ensureStarted();

    const latestDateResult = await queryPostgres(
      `
        SELECT MAX(report_date::date)::text AS latest_date
        FROM cot_institutional_positions
        WHERE report_type = 'FUTURES_ONLY'
      `,
    );
    const latestDate = String((latestDateResult.rows[0] as any)?.latest_date ?? '').trim() || null;

    const latestRows = latestDate
      ? await queryPostgres(
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
            net_change,
            bias,
            bias_strength
          FROM cot_institutional_positions
          WHERE report_type = 'FUTURES_ONLY'
            AND report_date::date = $1::date
          ORDER BY currency ASC
        `,
        [latestDate],
      ).then((r) => r.rows as any[])
      : [];

    const strongestBullishCurrency = (() => {
      const candidates = latestRows.filter((r) => Number(r?.net_positions ?? 0) > 0);
      if (!candidates.length) return null;
      const best = candidates.reduce((a, b) => Number(b.net_positions ?? 0) > Number(a.net_positions ?? 0) ? b : a, candidates[0]);
      return String(best.currency ?? '') || null;
    })();

    const strongestBearishCurrency = (() => {
      const candidates = latestRows.filter((r) => Number(r?.net_positions ?? 0) < 0);
      if (!candidates.length) return null;
      const best = candidates.reduce((a, b) => Number(b.net_positions ?? 0) < Number(a.net_positions ?? 0) ? b : a, candidates[0]);
      return String(best.currency ?? '') || null;
    })();

    const largestLongIncrease = (() => {
      const candidates = latestRows.filter((r) => r?.change_long != null);
      if (!candidates.length) return null;
      const best = candidates.reduce((a, b) => Number(b.change_long ?? 0) > Number(a.change_long ?? 0) ? b : a, candidates[0]);
      return { currency: String(best.currency ?? ''), value: Number(best.change_long) };
    })();

    const largestShortIncrease = (() => {
      const candidates = latestRows.filter((r) => r?.change_short != null);
      if (!candidates.length) return null;
      const best = candidates.reduce((a, b) => Number(b.change_short ?? 0) > Number(a.change_short ?? 0) ? b : a, candidates[0]);
      return { currency: String(best.currency ?? ''), value: Number(best.change_short) };
    })();

    const biggestNetPositionChange = (() => {
      const candidates = latestRows.filter((r) => r?.net_change != null);
      if (!candidates.length) return null;
      const best = candidates.reduce((a, b) => Math.abs(Number(b.net_change ?? 0)) > Math.abs(Number(a.net_change ?? 0)) ? b : a, candidates[0]);
      return { currency: String(best.currency ?? ''), value: Number(best.net_change) };
    })();

    const totalRecordsSynced = await queryPostgres(
      `
        SELECT COUNT(*)::int AS total
        FROM cot_institutional_positions
        WHERE report_type = 'FUTURES_ONLY'
      `,
    ).then((r) => Number((r.rows[0] as any)?.total ?? 0));

    const lastSyncLog = await queryPostgres(
      `
        SELECT id, job_type, status, message, fetched_at
        FROM cot_source_logs
        ORDER BY fetched_at DESC, id DESC
        LIMIT 1
      `,
    ).then((r) => (r.rows[0] as any) ?? null).catch(() => null);

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        summary: {
          latestCotReportDate: latestDate,
          strongestBullishCurrency,
          strongestBearishCurrency,
          largestLongIncrease,
          largestShortIncrease,
          biggestNetPositionChange,
          totalRecordsSynced,
          lastSyncStatus: lastSyncLog ? `${String(lastSyncLog.status ?? '').toUpperCase()} - ${String(lastSyncLog.job_type ?? '')}` : 'UNKNOWN',
          lastSyncAt: lastSyncLog?.fetched_at ? new Date(lastSyncLog.fetched_at).toISOString() : null,
        },
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
          error: 'Missing COT tables. Run database migration 012_cot_institutional_positions.sql.',
          summary: {
            latestCotReportDate: null,
            strongestBullishCurrency: null,
            strongestBearishCurrency: null,
            largestLongIncrease: null,
            largestShortIncrease: null,
            biggestNetPositionChange: null,
            totalRecordsSynced: 0,
            lastSyncStatus: 'MISSING_TABLES',
            lastSyncAt: null,
          },
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'cot_summary_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
