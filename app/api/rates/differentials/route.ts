export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';
import { ensureCentralBankRateTables, CentralBankRateSchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

type RateRow = { currency: string; actual_rate: number | null };

const pairs = [
  ['USD', 'EUR'],
  ['USD', 'GBP'],
  ['USD', 'JPY'],
  ['EUR', 'GBP'],
  ['AUD', 'NZD'],
  ['CAD', 'USD'],
] as const;

export async function GET(): Promise<Response> {
  try {
    new CentralBankRateSchedulerService().ensureStarted();
    await ensureCentralBankRateTables();

    const latest = await queryPostgres(
      `
        SELECT DISTINCT ON (currency) currency, actual_rate
        FROM central_bank_rate_history
        WHERE currency = ANY($1::text[])
        ORDER BY currency, release_date DESC, release_time DESC, fetched_at DESC
      `,
      [[...new Set(pairs.flat())]],
    );

    const byCurrency = new Map<string, number | null>();
    for (const row of latest.rows as RateRow[]) {
      byCurrency.set(String(row.currency), row.actual_rate == null ? null : Number(row.actual_rate));
    }

    const matrix = pairs.map(([base, quote]) => {
      const baseRate = byCurrency.get(base) ?? null;
      const quoteRate = byCurrency.get(quote) ?? null;
      const diff = baseRate != null && quoteRate != null ? baseRate - quoteRate : null;
      return { base, quote, baseRate, quoteRate, differential: diff };
    });

    return Response.json(
      { ok: true, generatedAt: new Date().toISOString(), matrix },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, generatedAt: new Date().toISOString(), matrix: [], error: error instanceof Error ? error.message : 'rates_differentials_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
