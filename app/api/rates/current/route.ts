export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';
import { ensureCentralBankRateTables, CentralBankRateSchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'] as const;

export async function GET(): Promise<Response> {
  try {
    new CentralBankRateSchedulerService().ensureStarted();
    await ensureCentralBankRateTables();

    const rows = await queryPostgres(
      `
        SELECT DISTINCT ON (h.currency)
          h.currency,
          h.central_bank,
          h.release_date::text AS release_date,
          h.release_time,
          h.actual_rate,
          h.forecast_rate,
          h.previous_rate,
          h.rate_change,
          h.surprise,
          h.bias,
          h.source_url,
          h.fetched_at::text AS fetched_at
        FROM central_bank_rate_history h
        WHERE h.currency = ANY($1::text[])
        ORDER BY h.currency, h.release_date DESC, h.release_time DESC, h.fetched_at DESC
      `,
      [[...currencies]],
    );

    const byCurrency = new Map<string, any>();
    for (const row of rows.rows as any[]) {
      byCurrency.set(String(row.currency), row);
    }

    return Response.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        rates: currencies.map((cur) => {
          const r = byCurrency.get(cur) ?? null;
          return {
            currency: cur,
            centralBank: r?.central_bank ?? null,
            releaseDate: r?.release_date ?? null,
            releaseTime: r?.release_time ?? null,
            actualRate: r?.actual_rate ?? null,
            forecastRate: r?.forecast_rate ?? null,
            previousRate: r?.previous_rate ?? null,
            rateChange: r?.rate_change ?? null,
            surprise: r?.surprise ?? null,
            bias: r?.bias ?? null,
            sourceUrl: r?.source_url ?? null,
            fetchedAt: r?.fetched_at ?? null,
          };
        }),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, generatedAt: new Date().toISOString(), rates: [], error: error instanceof Error ? error.message : 'rates_current_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
