export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';
import { ensureCentralBankRateTables, CentralBankRateSchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

export async function GET(): Promise<Response> {
  try {
    new CentralBankRateSchedulerService().ensureStarted();
    await ensureCentralBankRateTables();

    const rows = await queryPostgres(
      `
        SELECT
          id::text AS id,
          event_id,
          currency,
          sync_started_at::text AS sync_started_at,
          sync_completed_at::text AS sync_completed_at,
          status,
          rows_fetched,
          rows_inserted,
          rows_updated,
          error_message
        FROM rate_sync_logs
        ORDER BY sync_started_at DESC, id DESC
        LIMIT 400
      `,
    );

    return Response.json(
      { ok: true, generatedAt: new Date().toISOString(), logs: rows.rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, generatedAt: new Date().toISOString(), logs: [], error: error instanceof Error ? error.message : 'rates_sync_logs_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
