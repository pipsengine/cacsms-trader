export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { queryPostgres } from '@/lib/postgres';
import { ensureCentralBankRateTables, CentralBankRateSchedulerService } from '@/services/economic-data-service/src/investing-historical-rate-decision';

type BiasRow = {
  currency: string;
  hikes: number;
  cuts: number;
  holds: number;
  net_change: number | null;
  avg_surprise: number | null;
};

function classifyHawkish(score: number): 'Hawkish' | 'Neutral' | 'Dovish' {
  if (score > 25) return 'Hawkish';
  if (score < -25) return 'Dovish';
  return 'Neutral';
}

function buildAiSummary(input: {
  mostHawkish: string | null;
  mostDovish: string | null;
  differentials: Array<{ base: string; quote: string; differential: number | null }>;
}): string {
  const lines: string[] = [];
  lines.push('Monetary policy read-through based on latest central-bank rate decisions and rate differentials.');
  if (input.mostHawkish) lines.push(`Strongest policy support: ${input.mostHawkish}.`);
  if (input.mostDovish) lines.push(`Weakest policy support: ${input.mostDovish}.`);
  const best = input.differentials.filter((x) => x.differential != null).sort((a, b) => Number(b.differential) - Number(a.differential))[0];
  if (best) lines.push(`Largest yield advantage among tracked pairs: ${best.base}/${best.quote} (${best.differential?.toFixed(2)}).`);
  lines.push('Risk warning: rate decisions can cause extreme spreads/slippage and invalidate technical signals around releases.');
  return lines.join(' ');
}

export async function GET(): Promise<Response> {
  try {
    new CentralBankRateSchedulerService().ensureStarted();
    await ensureCentralBankRateTables();

    const agg = await queryPostgres(
      `
        WITH recent AS (
          SELECT *
          FROM central_bank_rate_history
          WHERE release_date >= (now()::date - interval '3 years')
        )
        SELECT
          currency,
          SUM(CASE WHEN actual_rate IS NOT NULL AND previous_rate IS NOT NULL AND actual_rate > previous_rate THEN 1 ELSE 0 END)::int AS hikes,
          SUM(CASE WHEN actual_rate IS NOT NULL AND previous_rate IS NOT NULL AND actual_rate < previous_rate THEN 1 ELSE 0 END)::int AS cuts,
          SUM(CASE WHEN actual_rate IS NOT NULL AND previous_rate IS NOT NULL AND actual_rate = previous_rate THEN 1 ELSE 0 END)::int AS holds,
          SUM(CASE WHEN actual_rate IS NOT NULL AND previous_rate IS NOT NULL THEN (actual_rate - previous_rate) ELSE NULL END) AS net_change,
          AVG(CASE WHEN actual_rate IS NOT NULL AND forecast_rate IS NOT NULL THEN (actual_rate - forecast_rate) ELSE NULL END) AS avg_surprise
        FROM recent
        GROUP BY currency
      `,
    );

    const scores = (agg.rows as any[]).map((row) => {
      const currency = String(row.currency);
      const netChange = row.net_change == null ? null : Number(row.net_change);
      const avgSurprise = row.avg_surprise == null ? null : Number(row.avg_surprise);
      const hikes = Number(row.hikes ?? 0);
      const cuts = Number(row.cuts ?? 0);
      const holds = Number(row.holds ?? 0);
      const score = (netChange ?? 0) * 100 + (avgSurprise ?? 0) * 50 + hikes * 10 - cuts * 10;
      return { currency, hikes, cuts, holds, netChange, avgSurprise, score, classification: classifyHawkish(score) };
    });

    const mostHawkish = scores.filter((s) => Number.isFinite(s.score)).sort((a, b) => b.score - a.score)[0]?.currency ?? null;
    const mostDovish = scores.filter((s) => Number.isFinite(s.score)).sort((a, b) => a.score - b.score)[0]?.currency ?? null;

    const latest = await queryPostgres(
      `
        SELECT DISTINCT ON (currency)
          currency,
          actual_rate,
          previous_rate,
          forecast_rate,
          release_date::text AS release_date,
          NULLIF(release_time,'') AS release_time,
          central_bank
        FROM central_bank_rate_history
        ORDER BY currency, release_date DESC, release_time DESC, fetched_at DESC
      `,
    );

    const current = new Map<string, any>();
    for (const row of latest.rows as any[]) current.set(String(row.currency), row);

    const trackedPairs = [
      { base: 'USD', quote: 'EUR' },
      { base: 'USD', quote: 'GBP' },
      { base: 'USD', quote: 'JPY' },
      { base: 'EUR', quote: 'GBP' },
      { base: 'AUD', quote: 'NZD' },
      { base: 'CAD', quote: 'USD' },
    ];
    const differentials = trackedPairs.map((p) => {
      const br = current.get(p.base)?.actual_rate;
      const qr = current.get(p.quote)?.actual_rate;
      const baseRate = br == null ? null : Number(br);
      const quoteRate = qr == null ? null : Number(qr);
      const diff = baseRate != null && quoteRate != null ? baseRate - quoteRate : null;
      return { base: p.base, quote: p.quote, differential: diff };
    });

    const aiSummary = buildAiSummary({ mostHawkish, mostDovish, differentials });

    return Response.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        currencies: scores,
        mostHawkishCurrency: mostHawkish,
        mostDovishCurrency: mostDovish,
        aiSummary,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, generatedAt: new Date().toISOString(), currencies: [], mostHawkishCurrency: null, mostDovishCurrency: null, aiSummary: '', error: error instanceof Error ? error.message : 'rates_bias_failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
