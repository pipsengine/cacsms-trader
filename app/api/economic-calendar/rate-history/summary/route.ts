import { NextResponse } from 'next/server';
import { queryPostgres } from '@/lib/postgres';
import { ensureRateDecisionHistoryTables, InvestingRateDecisionWeeklySchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    new InvestingRateDecisionWeeklySchedulerService().ensureStarted();
    await ensureRateDecisionHistoryTables();

    const latest = await queryPostgres(
      `
        SELECT
          MAX(release_date::date)::text AS latest_release_date,
          (SELECT currency
            FROM rate_decision_history
            WHERE release_date::date = (SELECT MAX(release_date::date) FROM rate_decision_history)
            ORDER BY captured_at DESC NULLS LAST
            LIMIT 1) AS latest_currency,
          (SELECT central_bank
            FROM rate_decision_history
            WHERE release_date::date = (SELECT MAX(release_date::date) FROM rate_decision_history)
            ORDER BY captured_at DESC NULLS LAST
            LIMIT 1) AS latest_central_bank,
          (SELECT captured_at::text
            FROM rate_decision_history
            ORDER BY captured_at DESC NULLS LAST
            LIMIT 1) AS last_captured_at
        FROM rate_decision_history
      `,
    ).then((r) => (r.rows[0] as any) ?? {});

    const totals = await queryPostgres(
      `
        SELECT COUNT(*)::int AS total
        FROM rate_decision_history
      `,
    ).then((r) => Number((r.rows[0] as any)?.total ?? 0));

    const last3Years = await queryPostgres(
      `
        SELECT
          SUM(CASE WHEN decision_type = 'HIKE' THEN 1 ELSE 0 END)::int AS hikes,
          SUM(CASE WHEN decision_type = 'CUT' THEN 1 ELSE 0 END)::int AS cuts,
          SUM(CASE WHEN decision_type = 'HOLD' THEN 1 ELSE 0 END)::int AS holds
        FROM rate_decision_history
        WHERE release_date >= (now() - interval '3 years')::date
      `,
    ).then((r) => (r.rows[0] as any) ?? {});

    const hawkDove = await queryPostgres(
      `
        SELECT
          currency,
          SUM(
            CASE
              WHEN decision_type = 'HIKE' THEN 1
              WHEN decision_type = 'CUT' THEN -1
              ELSE 0
            END
            +
            CASE
              WHEN surprise_direction = 'HAWKISH_SURPRISE' THEN 0.5
              WHEN surprise_direction = 'DOVISH_SURPRISE' THEN -0.5
              ELSE 0
            END
          ) AS score
        FROM rate_decision_history
        WHERE release_date >= (now() - interval '3 years')::date
        GROUP BY currency
      `,
    ).then((r) => (r.rows as any[]) ?? []);

    const mostHawkishCurrency = hawkDove.length
      ? String(hawkDove.reduce((a, b) => Number(b.score ?? 0) > Number(a.score ?? 0) ? b : a, hawkDove[0]).currency ?? '') || null
      : null;
    const mostDovishCurrency = hawkDove.length
      ? String(hawkDove.reduce((a, b) => Number(b.score ?? 0) < Number(a.score ?? 0) ? b : a, hawkDove[0]).currency ?? '') || null
      : null;

    const lastSync = await queryPostgres(
      `
        SELECT job_type, status, message, fetched_at::text AS fetched_at
        FROM rate_decision_history_logs
        WHERE job_type IN ('rate_history_sync_done','rate_history_weekly_scheduler')
        ORDER BY fetched_at DESC, id DESC
        LIMIT 1
      `,
    ).then((r) => (r.rows[0] as any) ?? null).catch(() => null);

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        summary: {
          totalHistoricalRateRecords: totals,
          rateHikesLast3Years: Number(last3Years.hikes ?? 0),
          rateCutsLast3Years: Number(last3Years.cuts ?? 0),
          holdsLast3Years: Number(last3Years.holds ?? 0),
          mostHawkishCurrency,
          mostDovishCurrency,
          lastCapturedRateEvent: latest.latest_release_date ? {
            releaseDate: String(latest.latest_release_date),
            currency: latest.latest_currency ? String(latest.latest_currency) : null,
            centralBank: latest.latest_central_bank ? String(latest.latest_central_bank) : null,
          } : null,
          lastCapturedAt: latest.last_captured_at ? String(latest.last_captured_at) : null,
          lastSyncStatus: lastSync ? `${String(lastSync.status ?? '').toUpperCase()} - ${String(lastSync.job_type ?? '')}` : 'UNKNOWN',
          lastSyncAt: lastSync?.fetched_at ? String(lastSync.fetched_at) : null,
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
          error: 'Missing rate decision tables. Run database migration 013_rate_decision_history.sql.',
          summary: {
            totalHistoricalRateRecords: 0,
            rateHikesLast3Years: 0,
            rateCutsLast3Years: 0,
            holdsLast3Years: 0,
            mostHawkishCurrency: null,
            mostDovishCurrency: null,
            lastCapturedRateEvent: null,
            lastCapturedAt: null,
            lastSyncStatus: 'MISSING_TABLES',
            lastSyncAt: null,
          },
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'rate_history_summary_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
